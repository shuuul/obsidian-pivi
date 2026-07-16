import type {
  AgentRun,
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/pivi-agent-core/foundation';
import {
  resolveSubagentActivityStatus,
  resolveToolActivityStatus,
} from '@pivi/pivi-agent-core/foundation';
import {
  type AgentReport,
  extractAgentReportFromText,
  parseAgentReport,
} from '@pivi/pivi-agent-core/session/continuationSchemas';

export interface ChatAgentRunEntity extends AgentRun {
  readonly id: string;
  readonly messageId: string;
  readonly agent: SubagentInfo;
  readonly report: AgentReport | null;
}

/** Derive the stable Agent-run read models nested beneath one spawn tool. */
export function deriveAgentRunEntities(
  tool: ToolCallInfo,
  messageId: string,
  parentRunId: string | null,
): ChatAgentRunEntity[] {
  const subagent = tool.subagent;
  if (!subagent) return [];

  const childTools = subagent.toolCalls.filter(
    (candidate): candidate is ToolCallInfo & { subagent: SubagentInfo } => Boolean(candidate.subagent),
  );
  const currentTool = [...subagent.toolCalls].reverse().find((candidate) => {
    const status = resolveToolActivityStatus(candidate);
    return status === 'queued' || status === 'running' || status === 'waiting';
  });
  const runId = subagent.id;
  const report = parseAgentReport(tool.toolUseResult?.agent_report)
    ?? (subagent.result ? extractAgentReportFromText(subagent.result) : null);
  const entity: ChatAgentRunEntity = {
    id: runId,
    messageId,
    runId,
    parentRunId,
    owningMessageId: messageId,
    owningToolId: tool.id,
    ...(subagent.agentId ? { agentId: subagent.agentId } : {}),
    agent: subagent,
    report,
    childRunIds: childTools.map(candidate => candidate.subagent.id),
    ...(currentTool ? {
      currentActivity: {
        status: resolveToolActivityStatus(currentTool),
        toolId: currentTool.id,
        toolName: currentTool.name,
      },
    } : {}),
    description: subagent.description,
    mode: subagent.mode ?? 'sync',
    ...(subagent.prompt ? { prompt: subagent.prompt } : {}),
    ...(subagent.startedAt ?? tool.startedAt
      ? { startedAt: subagent.startedAt ?? tool.startedAt }
      : {}),
    ...(subagent.completedAt ?? tool.completedAt
      ? { completedAt: subagent.completedAt ?? tool.completedAt }
      : {}),
    status: resolveSubagentActivityStatus(subagent),
    ...(subagent.result ? {
      terminalResult: {
        ...(subagent.outputToolId ? { outputToolId: subagent.outputToolId } : {}),
        text: subagent.result,
      },
    } : {}),
    toolIds: subagent.toolCalls.map(candidate => candidate.id),
    usage: subagent.usage ? { ...subagent.usage } : null,
    ...(subagent.writerName ? { writerName: subagent.writerName } : {}),
  };

  return [
    entity,
    ...childTools.flatMap(child => deriveAgentRunEntities(child, messageId, runId)),
  ];
}
