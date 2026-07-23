/**
 * Turn-scoped high-risk approval controller.
 * Fail-closed on deny/cancel/timeout/invalidation; subagents inherit only.
 */

import {
  buildHighRiskGrantKey,
  fingerprintResources,
  HIGH_RISK_APPROVAL_TIMEOUT_MS,
  type HighRiskApprovalOutcome,
  type HighRiskApprovalPresenter,
  type HighRiskApprovalResult,
  type HighRiskAuditEntry,
  type HighRiskAuditSink,
  type HighRiskControllerMode,
  HighRiskDeniedError,
  type HighRiskGrant,
  type HighRiskOperationKind,
  type HighRiskOperationRequest,
  type HighRiskResourceSummary,
  isGrantNarrowerOrEqual,
  normalizeResourceSummary,
} from './types';

export interface HighRiskApprovalControllerOptions {
  presenter?: HighRiskApprovalPresenter;
  audit?: HighRiskAuditSink;
  timeoutMs?: number;
  now?: () => number;
}

interface PendingApproval {
  key: string;
  abort: AbortController;
}

function readAbortOutcome(signal: AbortSignal): HighRiskApprovalOutcome | undefined {
  const reason: unknown = (signal as { reason?: unknown }).reason;
  switch (reason) {
    case 'approved':
    case 'denied':
    case 'cancelled':
    case 'timeout':
    case 'invalidated':
    case 'subagent-denied':
      return reason;
    default:
      return undefined;
  }
}

function asAbortError(message: string): Error {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

export class HighRiskApprovalController {
  private mode: HighRiskControllerMode = 'interactive';
  private sessionId: string | null = null;
  private turnId: string | null = null;
  private readonly grants = new Map<string, HighRiskGrant>();
  private parentGrants: HighRiskGrant[] = [];
  private disposed = false;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: HighRiskApprovalControllerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? HIGH_RISK_APPROVAL_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  setMode(mode: HighRiskControllerMode): void {
    this.mode = mode;
  }

  getMode(): HighRiskControllerMode {
    return this.mode;
  }

  beginTurn(sessionId: string, turnId: string): void {
    this.rejectPending('invalidated');
    this.grants.clear();
    this.sessionId = sessionId;
    this.turnId = turnId;
    this.disposed = false;
  }

  endTurn(): void {
    this.rejectPending('invalidated');
    this.grants.clear();
    this.turnId = null;
  }

  setParentGrants(grants: readonly HighRiskGrant[]): void {
    this.parentGrants = grants.map((grant) => ({ ...grant }));
  }

  snapshotGrants(): HighRiskGrant[] {
    return [...this.grants.values()];
  }

  invalidate(reason: HighRiskApprovalOutcome = 'invalidated'): void {
    this.rejectPending(reason);
    this.grants.clear();
    this.parentGrants = [];
    this.sessionId = null;
    this.turnId = null;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate('invalidated');
  }

  hasMatchingGrant(
    kind: HighRiskOperationKind,
    resources: HighRiskResourceSummary,
  ): boolean {
    if (!this.sessionId || !this.turnId) {
      return false;
    }
    const key = buildHighRiskGrantKey(this.sessionId, this.turnId, kind, resources);
    return this.grants.has(key);
  }

  async authorize(
    partial: {
      kind: HighRiskOperationKind;
      resources: HighRiskResourceSummary;
      toolName?: string;
    },
  ): Promise<HighRiskApprovalResult> {
    if (this.disposed) {
      return this.finish(partial, 'invalidated');
    }
    if (!this.sessionId || !this.turnId) {
      return this.finish(partial, 'invalidated');
    }

    const request: HighRiskOperationRequest = {
      kind: partial.kind,
      sessionId: this.sessionId,
      turnId: this.turnId,
      resources: normalizeResourceSummary(partial.resources),
      toolName: partial.toolName,
    };
    const key = buildHighRiskGrantKey(
      request.sessionId,
      request.turnId,
      request.kind,
      request.resources,
    );

    const existing = this.grants.get(key);
    if (existing) {
      return { outcome: 'approved', grantKey: existing.key };
    }

    if (this.mode === 'inherit-only') {
      const inherited = this.findInheritedGrant(request);
      if (!inherited) {
        return this.finish(request, 'subagent-denied');
      }
      this.grants.set(key, {
        key,
        kind: request.kind,
        sessionId: request.sessionId,
        turnId: request.turnId,
        resourceFingerprint: fingerprintResources(request.resources),
        grantedAt: this.now(),
      });
      return { outcome: 'approved', grantKey: key };
    }

    const presenter = this.options.presenter;
    if (!presenter) {
      return this.finish(request, 'denied');
    }

    const abort = new AbortController();
    this.pending.set(key, { key, abort });

    try {
      const decision = await this.withTimeout(
        presenter.present(request),
        abort.signal,
      );
      if (this.disposed || this.sessionId !== request.sessionId || this.turnId !== request.turnId) {
        return this.finish(request, 'invalidated');
      }
      if (decision === 'approve') {
        this.grants.set(key, {
          key,
          kind: request.kind,
          sessionId: request.sessionId,
          turnId: request.turnId,
          resourceFingerprint: fingerprintResources(request.resources),
          grantedAt: this.now(),
        });
        this.record(request, 'approved');
        return { outcome: 'approved', grantKey: key };
      }
      const outcome: HighRiskApprovalOutcome = decision === 'deny' ? 'denied' : 'cancelled';
      return this.finish(request, outcome);
    } catch (error) {
      if (abort.signal.aborted) {
        return this.finish(request, readAbortOutcome(abort.signal) ?? 'timeout');
      }
      throw error;
    } finally {
      this.pending.delete(key);
    }
  }

  async requireAuthorized(
    partial: {
      kind: HighRiskOperationKind;
      resources: HighRiskResourceSummary;
      toolName?: string;
    },
  ): Promise<void> {
    const result = await this.authorize(partial);
    if (result.outcome !== 'approved') {
      throw new HighRiskDeniedError(result.outcome);
    }
  }

  recordExecution(
    partial: {
      kind: HighRiskOperationKind;
      resources: HighRiskResourceSummary;
      toolName?: string;
    },
    execution: 'completed' | 'failed' | 'skipped',
  ): void {
    if (!this.sessionId || !this.turnId) {
      return;
    }
    this.options.audit?.record({
      at: this.now(),
      kind: partial.kind,
      outcome: 'approved',
      sessionId: this.sessionId,
      turnId: this.turnId,
      resourceFingerprint: fingerprintResources(partial.resources),
      toolName: partial.toolName,
      execution,
    });
  }

  private findInheritedGrant(request: HighRiskOperationRequest): HighRiskGrant | null {
    for (const grant of this.parentGrants) {
      if (grant.kind !== request.kind) {
        continue;
      }
      if (grant.sessionId !== request.sessionId) {
        continue;
      }
      // Parent grants are from the parent turn; child turnId differs but authority
      // is capped by parent resource summary equality/narrowing.
      let parentResources: HighRiskResourceSummary;
      try {
        parentResources = JSON.parse(grant.resourceFingerprint) as HighRiskResourceSummary;
      } catch {
        continue;
      }
      if (isGrantNarrowerOrEqual(parentResources, request.resources)) {
        return grant;
      }
    }
    return null;
  }

  private finish(
    request: { kind: HighRiskOperationKind; resources: HighRiskResourceSummary; toolName?: string; sessionId?: string; turnId?: string },
    outcome: HighRiskApprovalOutcome,
  ): HighRiskApprovalResult {
    this.record(
      {
        kind: request.kind,
        sessionId: request.sessionId ?? this.sessionId ?? '',
        turnId: request.turnId ?? this.turnId ?? '',
        resources: request.resources,
        toolName: request.toolName,
      },
      outcome,
    );
    return { outcome };
  }

  private record(
    request: HighRiskOperationRequest | {
      kind: HighRiskOperationKind;
      sessionId: string;
      turnId: string;
      resources: HighRiskResourceSummary;
      toolName?: string;
    },
    outcome: HighRiskApprovalOutcome,
  ): void {
    const entry: HighRiskAuditEntry = {
      at: this.now(),
      kind: request.kind,
      outcome,
      sessionId: request.sessionId,
      turnId: request.turnId,
      resourceFingerprint: fingerprintResources(request.resources),
      toolName: request.toolName,
    };
    this.options.audit?.record(entry);
  }

  private rejectPending(reason: HighRiskApprovalOutcome): void {
    for (const pending of this.pending.values()) {
      pending.abort.abort(reason);
    }
    this.pending.clear();
  }

  private async withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      throw asAbortError(readAbortOutcome(signal) ?? 'aborted');
    }
    return await new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!signal.aborted) {
          const pending = [...this.pending.values()].find((entry) => entry.abort.signal === signal);
          pending?.abort.abort('timeout');
        }
        reject(asAbortError('timeout'));
      }, this.timeoutMs);

      const onAbort = (): void => {
        window.clearTimeout(timer);
        reject(asAbortError('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          window.clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}
