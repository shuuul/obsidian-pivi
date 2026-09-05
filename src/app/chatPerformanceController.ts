import type { ChatPerfRecorder } from '@pivi/pivi-react/store';

export interface ChatPerfProjectionWorkloadMetadata {
  readonly workload: 'nested-subagent' | 'small-text' | 'tool-heavy';
  readonly fixtureSha256: string;
  readonly warmupEvents: number;
  readonly sampleEvents: number;
}

export interface ChatPerfController extends ChatPerfRecorder {
  start(
    scenario: string,
    ownerWindow: Window,
    projectionWorkload?: ChatPerfProjectionWorkloadMetadata,
  ): void;
  sampleHeap(label: string, ownerWindow: Window): void;
  stopAndExport(ownerWindow: Window): Promise<string>;
  dispose(): void;
}

export const NOOP_CHAT_PERF_CONTROLLER: ChatPerfController = Object.freeze({
  enabled: false,
  dispose: () => undefined,
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
  sampleHeap: () => undefined,
  start: () => undefined,
  stopAndExport: () => Promise.reject(new Error('Chat performance tracing is unavailable.')),
});
