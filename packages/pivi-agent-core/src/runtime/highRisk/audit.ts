/**
 * In-memory / file-backed bounded metadata-only high-risk audit sink.
 */

import {
  HIGH_RISK_AUDIT_MAX_BYTES,
  HIGH_RISK_AUDIT_MAX_RECORDS,
  type HighRiskAuditEntry,
  type HighRiskAuditSink,
} from './types';

const FORBIDDEN_KEY_PATTERN = /(secret|password|token|authorization|cookie|api[_-]?key|credential|env|header|body|content|query)/i;

export function sanitizeAuditEntry(entry: HighRiskAuditEntry): HighRiskAuditEntry {
  return {
    at: entry.at,
    kind: entry.kind,
    outcome: entry.outcome,
    sessionId: entry.sessionId,
    turnId: entry.turnId,
    resourceFingerprint: entry.resourceFingerprint,
    ...(entry.toolName ? { toolName: entry.toolName } : {}),
    ...(entry.execution ? { execution: entry.execution } : {}),
  };
}

export function assertAuditEntrySafe(entry: HighRiskAuditEntry): void {
  const serialized = JSON.stringify(entry);
  if (FORBIDDEN_KEY_PATTERN.test(serialized) && /"(secret|password|token|authorization|apiKey|credential|body|content)":/i.test(serialized)) {
    throw new Error('High-risk audit entry contains forbidden sensitive fields');
  }
}

export class MemoryHighRiskAuditSink implements HighRiskAuditSink {
  private readonly entries: HighRiskAuditEntry[] = [];
  private bytes = 0;

  constructor(
    private readonly maxRecords = HIGH_RISK_AUDIT_MAX_RECORDS,
    private readonly maxBytes = HIGH_RISK_AUDIT_MAX_BYTES,
  ) {}

  record(entry: HighRiskAuditEntry): void {
    const safe = sanitizeAuditEntry(entry);
    assertAuditEntrySafe(safe);
    const encoded = JSON.stringify(safe);
    this.entries.push(safe);
    this.bytes += encoded.length + 1;
    this.trim();
  }

  list(): readonly HighRiskAuditEntry[] {
    return this.entries;
  }

  approximateBytes(): number {
    return this.bytes;
  }

  private trim(): void {
    while (
      this.entries.length > this.maxRecords
      || this.bytes > this.maxBytes
    ) {
      const removed = this.entries.shift();
      if (!removed) {
        break;
      }
      this.bytes -= JSON.stringify(removed).length + 1;
    }
  }
}

export interface FileHighRiskAuditStore {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

/**
 * Vault-relative diagnostics sink. Stores one JSONL line per event under a
 * fixed retention/byte budget. Callers must use a vault-relative mutation path.
 */
export class FileHighRiskAuditSink implements HighRiskAuditSink {
  private readonly memory = new MemoryHighRiskAuditSink();
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: FileHighRiskAuditStore,
  ) {}

  record(entry: HighRiskAuditEntry): void {
    this.memory.record(entry);
    this.queue = this.queue.then(() => this.persist()).catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  list(): readonly HighRiskAuditEntry[] {
    return this.memory.list();
  }

  private async persist(): Promise<void> {
    if (!this.loaded) {
      try {
        const raw = await this.store.read();
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as HighRiskAuditEntry;
            this.memory.record(parsed);
          } catch {
            // skip corrupt lines
          }
        }
      } catch {
        // missing file is fine
      }
      this.loaded = true;
    }
    const body = this.memory.list().map((entry) => JSON.stringify(entry)).join('\n');
    await this.store.write(body ? `${body}\n` : '');
  }
}
