import type { AgentTool, AgentToolResult, StreamFn } from '@earendil-works/pi-agent-core';
import {
  appendToolResultReminder,
  buildAliasReminder,
  isSilentToolNameAlias,
  listSilentNameAliases,
  normalizeToolCallArguments,
  resolveLiveToolName,
  type ToolSpec,
} from '@pivi/agent/tools';

function withAliasReminder(
  result: unknown,
  calledName: string,
  rawArguments: unknown,
): unknown {
  const reminder = buildAliasReminder(calledName, rawArguments);
  if (!reminder) {
    return result;
  }
  return appendToolResultReminder(result, reminder);
}

export function toPiAgentTool(spec: ToolSpec): AgentTool {
  const liveName = resolveLiveToolName(spec.name);
  return {
    name: spec.name,
    label: spec.label ?? spec.name,
    description: spec.description,
    parameters: spec.parameters,
    ...(spec.executionMode ? { executionMode: spec.executionMode } : {}),
    prepareArguments(args) {
      return normalizeToolCallArguments(liveName, args).args;
    },
    async execute(toolCallId, params, signal) {
      const result = await spec.execute(toolCallId, params, signal) as AgentToolResult<unknown>;
      return withAliasReminder(result, spec.name, params) as AgentToolResult<unknown>;
    },
  };
}

/**
 * Prompt-facing tools keep live names only. Silent aliases are extra AgentTools
 * that execute the live spec so Pi's exact-name dispatch still works.
 */
export function expandPiToolsWithSilentAliases(liveTools: AgentTool[]): AgentTool[] {
  const byName = new Map(liveTools.map((tool) => [tool.name, tool]));
  const extras: AgentTool[] = [];
  for (const live of liveTools) {
    for (const alias of listSilentNameAliases(live.name)) {
      if (byName.has(alias)) {
        continue;
      }
      const extra: AgentTool = {
        ...live,
        name: alias,
        label: live.label ?? live.name,
        prepareArguments(args) {
          return live.prepareArguments
            ? live.prepareArguments(args)
            : normalizeToolCallArguments(live.name, args).args;
        },
        async execute(toolCallId, params, signal, onUpdate) {
          const result = await live.execute(toolCallId, params, signal, onUpdate);
          return withAliasReminder(result, alias, params) as AgentToolResult<unknown>;
        },
      };
      extras.push(extra);
      byName.set(alias, extra);
    }
  }
  return [...liveTools, ...extras];
}

export function filterPromptFacingPiTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((tool) => !isSilentToolNameAlias(tool.name));
}

export function wrapStreamFnToHideAliasTools(streamFn: StreamFn): StreamFn {
  return (model, context, options) => {
    if (!context.tools) {
      return streamFn(model, context, options);
    }
    return streamFn(model, { ...context, tools: filterPromptFacingPiTools(context.tools) }, options);
  };
}
