import type {
  ChatPerfProjectionCommitReason,
  ChatPerfProjectionEventKind,
} from '@pivi/pivi-react/store';
import type { App, DataAdapter } from 'obsidian';

import type { ChatPerfController } from '@/app/chatPerformanceController';

const CHAT_PERF_TRACE_DIRECTORY = '.pivi/perf-traces';
const CHAT_PERF_TRACE_SCHEMA = 'pivi-chat-perf-v1';

type ChatPerfWindowType = 'main' | 'pop-out';

interface ChromiumPerformance extends Performance {
  readonly memory?: {
    readonly jsHeapSizeLimit: number;
    readonly totalJSHeapSize: number;
    readonly usedJSHeapSize: number;
  };
}

interface PendingProjectionEvent {
  count: number;
  firstAtMs: number;
  lastAtMs: number;
}

interface PendingPaint {
  commitAtMs: number;
  eventAtMs: number | null;
}

export type ChatPerfTraceEvent =
  | {
      type: 'projection.commit';
      atMs: number;
      windowType: ChatPerfWindowType;
      reason: ChatPerfProjectionCommitReason;
      messageIds: readonly string[];
      queuedEventCount: number;
      eventToCommitMs: number | null;
      commitDurationMs: number;
    }
  | {
      type: 'projection.paint';
      atMs: number;
      windowType: ChatPerfWindowType;
      reason: ChatPerfProjectionCommitReason;
      messageIds: readonly string[];
      commitToPaintMs: number | null;
      eventToPaintMs: number | null;
    }
  | {
      type: 'virtual.rows';
      atMs: number;
      windowType: ChatPerfWindowType;
      mountedRows: number;
      domNodes: number;
    }
  | {
      type: 'scroll.anchor';
      atMs: number;
      windowType: ChatPerfWindowType;
      anchorId: string;
      driftPx: number;
    }
  | {
      type: 'markdown.render';
      atMs: number;
      windowType: ChatPerfWindowType;
      blockId: string;
      phase: 'streaming' | 'terminal';
      contentLength: number;
      durationMs: number;
    }
  | {
      type: 'longtask';
      atMs: number;
      windowType: ChatPerfWindowType;
      durationMs: number;
      name: string;
    }
  | {
      type: 'heap.sample';
      atMs: number;
      windowType: ChatPerfWindowType;
      label: string;
      available: boolean;
      jsHeapSizeLimit: number | null;
      totalJSHeapSize: number | null;
      usedJSHeapSize: number | null;
    };

export interface ChatPerfTrace {
  readonly schema: typeof CHAT_PERF_TRACE_SCHEMA;
  readonly scenario: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly environment: {
    readonly obsidianVersion: string;
    readonly piviVersion: string;
    readonly windowTypes: readonly ChatPerfWindowType[];
    readonly longTaskWindowTypes: readonly ChatPerfWindowType[];
  };
  readonly events: readonly ChatPerfTraceEvent[];
}

interface ActiveTrace {
  scenario: string;
  startedAt: string;
  startedAtEpochMs: number;
  events: ChatPerfTraceEvent[];
  pendingProjectionEvents: Map<string, PendingProjectionEvent>;
  pendingPaints: Map<string, PendingPaint>;
  windowTypes: Set<ChatPerfWindowType>;
  longTaskWindowTypes: Set<ChatPerfWindowType>;
}

function projectionEventKey(kind: ChatPerfProjectionEventKind, entityId: string | null): string {
  return entityId ? `message:${entityId}` : kind;
}

function projectionCommitKeys(
  reason: ChatPerfProjectionCommitReason,
  messageIds: readonly string[],
): string[] {
  if (reason === 'replace') return ['messages.replace'];
  if (reason === 'truncate') return ['messages.truncate'];
  return messageIds.map(messageId => `message:${messageId}`);
}

function paintKey(reason: ChatPerfProjectionCommitReason, messageIds: readonly string[]): string {
  return `${reason}:${messageIds.join(',')}`;
}

function sanitizeScenario(scenario: string): string {
  const slug = scenario
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return slug || 'manual';
}

async function ensureFolder(adapter: DataAdapter, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

class ObsidianChatPerfRecorder implements ChatPerfController {
  private activeTrace: ActiveTrace | null = null;
  private readonly observers = new Map<Window, PerformanceObserver>();

  constructor(
    private readonly app: App,
    private readonly piviVersion: string,
    private readonly obsidianVersion: string,
    private readonly mainWindow: Window,
  ) {}

  get enabled(): boolean {
    return this.activeTrace !== null;
  }

  now(ownerWindow: Window | null): number {
    return (ownerWindow ?? this.mainWindow).performance.now();
  }

  start(scenario: string, ownerWindow: Window): void {
    if (this.activeTrace) throw new Error('A chat performance trace is already active.');
    const normalizedScenario = scenario.trim();
    if (!normalizedScenario) throw new Error('A chat performance scenario is required.');
    const now = new Date();
    this.activeTrace = {
      scenario: normalizedScenario,
      startedAt: now.toISOString(),
      startedAtEpochMs: now.getTime(),
      events: [],
      pendingProjectionEvents: new Map(),
      pendingPaints: new Map(),
      windowTypes: new Set(),
      longTaskWindowTypes: new Set(),
    };
    this.observeWindow(ownerWindow);
    this.sampleHeap('start', ownerWindow);
  }

  sampleHeap(label: string, ownerWindow: Window): void {
    const trace = this.requireActiveTrace();
    this.observeWindow(ownerWindow);
    const memory = (ownerWindow.performance as ChromiumPerformance).memory;
    trace.events.push({
      type: 'heap.sample',
      atMs: this.elapsedMs(ownerWindow),
      windowType: this.windowType(ownerWindow),
      label,
      available: memory !== undefined,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
      totalJSHeapSize: memory?.totalJSHeapSize ?? null,
      usedJSHeapSize: memory?.usedJSHeapSize ?? null,
    });
  }

  async stopAndExport(ownerWindow: Window): Promise<string> {
    const trace = this.requireActiveTrace();
    this.sampleHeap('end', ownerWindow);
    const endedAt = new Date().toISOString();
    const output: ChatPerfTrace = {
      schema: CHAT_PERF_TRACE_SCHEMA,
      scenario: trace.scenario,
      startedAt: trace.startedAt,
      endedAt,
      environment: {
        obsidianVersion: this.obsidianVersion,
        piviVersion: this.piviVersion,
        windowTypes: [...trace.windowTypes].sort(),
        longTaskWindowTypes: [...trace.longTaskWindowTypes].sort(),
      },
      events: trace.events,
    };
    const timestamp = endedAt.replace(/[:.]/g, '-');
    const path = `${CHAT_PERF_TRACE_DIRECTORY}/${timestamp}-${sanitizeScenario(trace.scenario)}.json`;
    await ensureFolder(this.app.vault.adapter, CHAT_PERF_TRACE_DIRECTORY);
    await this.app.vault.adapter.write(path, `${JSON.stringify(output, null, 2)}\n`);
    this.clearActiveTrace();
    return path;
  }

  dispose(): void {
    this.clearActiveTrace();
  }

  onProjectionEvent(
    kind: ChatPerfProjectionEventKind,
    entityId: string | null,
    ownerWindow: Window | null,
  ): void {
    const trace = this.activeTrace;
    if (!trace) return;
    const targetWindow = ownerWindow ?? this.mainWindow;
    this.observeWindow(targetWindow);
    const key = projectionEventKey(kind, entityId);
    const atMs = this.elapsedMs(targetWindow);
    const pending = trace.pendingProjectionEvents.get(key);
    if (pending) {
      pending.count += 1;
      pending.lastAtMs = atMs;
    } else {
      trace.pendingProjectionEvents.set(key, { count: 1, firstAtMs: atMs, lastAtMs: atMs });
    }
  }

  onProjectionCommit(
    reason: ChatPerfProjectionCommitReason,
    messageIds: readonly string[],
    durationMs: number,
    ownerWindow: Window | null,
  ): void {
    const trace = this.activeTrace;
    if (!trace) return;
    const targetWindow = ownerWindow ?? this.mainWindow;
    this.observeWindow(targetWindow);
    const atMs = this.elapsedMs(targetWindow);
    let queuedEventCount = 0;
    let firstEventAtMs: number | null = null;
    for (const key of projectionCommitKeys(reason, messageIds)) {
      const pending = trace.pendingProjectionEvents.get(key);
      if (!pending) continue;
      trace.pendingProjectionEvents.delete(key);
      queuedEventCount += pending.count;
      firstEventAtMs = firstEventAtMs === null
        ? pending.firstAtMs
        : Math.min(firstEventAtMs, pending.firstAtMs);
    }
    trace.events.push({
      type: 'projection.commit',
      atMs,
      windowType: this.windowType(targetWindow),
      reason,
      messageIds: [...messageIds],
      queuedEventCount,
      eventToCommitMs: firstEventAtMs === null ? null : Math.max(0, atMs - firstEventAtMs),
      commitDurationMs: durationMs,
    });
    trace.pendingPaints.set(paintKey(reason, messageIds), {
      commitAtMs: atMs,
      eventAtMs: firstEventAtMs,
    });
  }

  onProjectionPaint(
    reason: ChatPerfProjectionCommitReason,
    messageIds: readonly string[],
    ownerWindow: Window,
  ): void {
    const trace = this.activeTrace;
    if (!trace) return;
    this.observeWindow(ownerWindow);
    const atMs = this.elapsedMs(ownerWindow);
    const key = paintKey(reason, messageIds);
    const pending = trace.pendingPaints.get(key);
    trace.pendingPaints.delete(key);
    trace.events.push({
      type: 'projection.paint',
      atMs,
      windowType: this.windowType(ownerWindow),
      reason,
      messageIds: [...messageIds],
      commitToPaintMs: pending ? Math.max(0, atMs - pending.commitAtMs) : null,
      eventToPaintMs: pending?.eventAtMs === null || pending?.eventAtMs === undefined
        ? null
        : Math.max(0, atMs - pending.eventAtMs),
    });
  }

  onVirtualRows(
    mountedRows: number,
    domNodes: number,
    ownerWindow: Window,
  ): void {
    const trace = this.activeTrace;
    if (!trace) return;
    this.observeWindow(ownerWindow);
    trace.events.push({
      type: 'virtual.rows',
      atMs: this.elapsedMs(ownerWindow),
      windowType: this.windowType(ownerWindow),
      mountedRows,
      domNodes,
    });
  }

  onScrollAnchor(anchorId: string, driftPx: number, ownerWindow: Window): void {
    const trace = this.activeTrace;
    if (!trace) return;
    this.observeWindow(ownerWindow);
    trace.events.push({
      type: 'scroll.anchor',
      atMs: this.elapsedMs(ownerWindow),
      windowType: this.windowType(ownerWindow),
      anchorId,
      driftPx,
    });
  }

  onMarkdownRender(
    blockId: string,
    phase: 'streaming' | 'terminal',
    contentLength: number,
    durationMs: number,
    ownerWindow: Window,
  ): void {
    const trace = this.activeTrace;
    if (!trace) return;
    this.observeWindow(ownerWindow);
    trace.events.push({
      type: 'markdown.render',
      atMs: this.elapsedMs(ownerWindow),
      windowType: this.windowType(ownerWindow),
      blockId,
      phase,
      contentLength,
      durationMs,
    });
  }

  private requireActiveTrace(): ActiveTrace {
    if (!this.activeTrace) throw new Error('No chat performance trace is active.');
    return this.activeTrace;
  }

  private elapsedMs(ownerWindow: Window): number {
    const trace = this.requireActiveTrace();
    return Math.max(
      0,
      ownerWindow.performance.timeOrigin + ownerWindow.performance.now() - trace.startedAtEpochMs,
    );
  }

  private windowType(ownerWindow: Window): ChatPerfWindowType {
    return ownerWindow === this.mainWindow ? 'main' : 'pop-out';
  }

  private observeWindow(ownerWindow: Window): void {
    const trace = this.requireActiveTrace();
    const type = this.windowType(ownerWindow);
    trace.windowTypes.add(type);
    if (this.observers.has(ownerWindow)) return;
    const Observer = (ownerWindow as Window & {
      PerformanceObserver?: typeof PerformanceObserver;
    }).PerformanceObserver;
    if (!Observer || !Observer.supportedEntryTypes.includes('longtask')) return;
    const observer = new Observer((list) => {
      const active = this.activeTrace;
      if (!active) return;
      for (const entry of list.getEntries()) {
        active.events.push({
          type: 'longtask',
          atMs: Math.max(
            0,
            ownerWindow.performance.timeOrigin + entry.startTime - active.startedAtEpochMs,
          ),
          windowType: type,
          durationMs: entry.duration,
          name: entry.name,
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    this.observers.set(ownerWindow, observer);
    trace.longTaskWindowTypes.add(type);
  }

  private clearActiveTrace(): void {
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    this.activeTrace = null;
  }
}

export function createChatPerfController(
  app: App,
  piviVersion: string,
  obsidianVersion: string,
  mainWindow: Window,
): ChatPerfController {
  return new ObsidianChatPerfRecorder(app, piviVersion, obsidianVersion, mainWindow);
}
