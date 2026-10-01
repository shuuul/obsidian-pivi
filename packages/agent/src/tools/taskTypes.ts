import type { ToolCallInfo } from './types';

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
