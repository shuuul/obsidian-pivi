import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';

import type { AsyncSubagentState } from '../rendering/AsyncSubagentRenderer';
import type { SubagentState } from '../rendering/SubagentRenderer';

export type SubagentStateChangeCallback = (subagent: SubagentInfo) => void;

export type HandleTaskResult =
  | { action: 'buffered' }
  | { action: 'created_sync'; subagentState: SubagentState }
  | { action: 'created_async'; info: SubagentInfo; domState: AsyncSubagentState }
  | { action: 'label_updated' };

export type RenderPendingResult =
  | { mode: 'sync'; subagentState: SubagentState }
  | { mode: 'async'; info: SubagentInfo; domState: AsyncSubagentState };
