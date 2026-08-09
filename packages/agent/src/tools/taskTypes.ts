import type { SubagentInfo, ToolCallInfo } from '../foundation';

export type TaskTerminalStatus = Extract<
  ToolCallInfo['status'],
  'completed' | 'error'
>;

export interface TaskResultInterpreter {
  hasAsyncLaunchMarker(toolUseResult: unknown): boolean;
  extractAgentId(toolUseResult: unknown): string | null;
  extractStructuredResult(toolUseResult: unknown): string | null;
  resolveTerminalStatus(
    toolUseResult: unknown,
    fallbackStatus: TaskTerminalStatus,
  ): TaskTerminalStatus;
  extractTagValue(payload: string, tagName: string): string | null;
}

export interface SubagentLaunchResult {
  agentId?: string;
  nickname?: string;
}

export interface SubagentWaitStatus {
  completed?: string;
  error?: string;
  failed?: string;
}

export interface SubagentWaitResult {
  statuses: Record<string, SubagentWaitStatus>;
  timedOut: boolean;
}

export interface SubagentLifecycleAdapter {
  isHiddenTool(name: string): boolean;
  isSpawnTool(name: string): boolean;
  isWaitTool(name: string): boolean;
  isCloseTool(name: string): boolean;
  resolveSpawnToolIds(
    waitToolCall: ToolCallInfo,
    agentIdToSpawnId: ReadonlyMap<string, string>,
  ): string[];
  buildSubagentInfo(
    spawnToolCall: ToolCallInfo,
    siblingToolCalls?: ToolCallInfo[],
  ): SubagentInfo;
  extractSpawnResult(raw: string | undefined): SubagentLaunchResult;
  extractWaitResult(raw: string | undefined): SubagentWaitResult;
}
