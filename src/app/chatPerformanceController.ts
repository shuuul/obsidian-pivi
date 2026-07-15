import type { ChatPerfRecorder } from '@pivi/pivi-react/store';

export interface ChatPerfController extends ChatPerfRecorder {
  start(scenario: string, ownerWindow: Window): void;
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
  onProjectionEvent: () => undefined,
  onProjectionPaint: () => undefined,
  onScrollAnchor: () => undefined,
  onVirtualRows: () => undefined,
  sampleHeap: () => undefined,
  start: () => undefined,
  stopAndExport: () => Promise.reject(new Error('Chat performance tracing is unavailable.')),
});
