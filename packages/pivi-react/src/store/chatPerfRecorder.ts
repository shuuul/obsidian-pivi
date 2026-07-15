export type ChatPerfProjectionEventKind =
  | 'message.upsert'
  | 'messages.replace'
  | 'messages.truncate';

export type ChatPerfProjectionCommitReason =
  | 'animation-frame'
  | 'explicit-flush'
  | 'immediate'
  | 'replace'
  | 'truncate';

/** Optional instrumentation seam. Implementations remain app-owned and dev-only. */
export interface ChatPerfRecorder {
  readonly enabled: boolean;
  now(ownerWindow: Window | null): number;
  onProjectionEvent(
    kind: ChatPerfProjectionEventKind,
    entityId: string | null,
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
  onProjectionEvent: () => undefined,
  onProjectionPaint: () => undefined,
  onScrollAnchor: () => undefined,
  onVirtualRows: () => undefined,
});
