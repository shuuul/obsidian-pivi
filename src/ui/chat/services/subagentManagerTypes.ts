import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';

export type SubagentStateChangeCallback = (subagent: SubagentInfo) => void;

export type HandleTaskResult =
  | { action: 'buffered' }
  | { action: 'created_sync'; info: SubagentInfo }
  | { action: 'created_async'; info: SubagentInfo }
  | { action: 'label_updated'; info: SubagentInfo };

export type RenderPendingResult = {
  mode: 'sync' | 'async';
  info: SubagentInfo;
};
