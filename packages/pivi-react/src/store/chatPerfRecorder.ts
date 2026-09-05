export type ChatPerfProjectionEventKind =
  | 'message.upsert'
  | 'messages.replace'
  | 'messages.truncate';

export type ChatPerfProjectionEventType =
  | ChatPerfProjectionEventKind
  | 'agent.upsert'
  | 'messages.prepend-page'
  | 'messages.reveal-previous-page'
  | 'projection.flush'
  | 'run.terminal'
  | 'text.append'
  | 'tool.upsert';

export type ChatPerfProjectionCommitReason =
  | 'animation-frame'
  | 'explicit-flush'
  | 'hidden-timer'
  | 'immediate'
  | 'replace'
  | 'truncate'
  | 'visibility-resume';

/** Optional instrumentation seam. Implementations remain app-owned and dev-only. */
export interface ChatPerfRecorder {
  readonly enabled: boolean;
  now(ownerWindow: Window | null): number;
  onProjectionEvent(
    kind: ChatPerfProjectionEventKind,
    entityId: string | null,
    ownerWindow: Window | null,
  ): void;
  onProjectionDispatch(
    eventType: ChatPerfProjectionEventType,
    accepted: boolean,
    validationDurationMs: number,
    totalDurationMs: number,
    ownerWindow: Window | null,
  ): void;
  onProjectionSnapshot(
    eventType: ChatPerfProjectionEventType,
    messageId: string,
    durationMs: number,
    visitedEntities: number,
    clonedEntities: number,
    ownerWindow: Window | null,
  ): void;
  onProjectionEntityCommit(
    messageId: string,
    durationMs: number,
    ownerWindow: Window | null,
  ): void;
  onProjectionCommit(
    reason: ChatPerfProjectionCommitReason,
    messageIds: readonly string[],
    durationMs: number,
    ownerWindow: Window | null,
  ): void;
  onProjectionPaint(
    reason: ChatPerfProjectionCommitReason,
    messageIds: readonly string[],
    ownerWindow: Window,
  ): void;
  onVirtualRows(
    mountedRows: number,
    domNodes: number,
    ownerWindow: Window,
  ): void;
  onScrollAnchor(
    anchorId: string,
    driftPx: number,
    ownerWindow: Window,
  ): void;
  onMarkdownRender(
    blockId: string,
    phase: 'streaming' | 'terminal',
    contentLength: number,
    durationMs: number,
    ownerWindow: Window,
  ): void;
}

export const NOOP_CHAT_PERF_RECORDER: ChatPerfRecorder = Object.freeze({
  enabled: false,
  now: () => 0,
  onMarkdownRender: () => undefined,
  onProjectionCommit: () => undefined,
  onProjectionDispatch: () => undefined,
  onProjectionEntityCommit: () => undefined,
  onProjectionEvent: () => undefined,
  onProjectionPaint: () => undefined,
  onProjectionSnapshot: () => undefined,
  onScrollAnchor: () => undefined,
  onVirtualRows: () => undefined,
});
