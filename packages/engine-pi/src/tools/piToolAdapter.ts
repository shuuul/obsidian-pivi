import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentTool,
  AgentToolResult,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import {
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  withoutInitialSystemMessage,
} from '@earendil-works/pi-ai';
import {
  appendToolResultReminder,
  buildAliasReminder,
  isSilentToolNameAlias,
  listSilentNameAliases,
  normalizeToolCallArguments,
  resolveLiveToolName,
  type ToolSpec,
} from '@pivi/agent/tools';

/**
 * Remind from the raw tool-call name and arguments. `prepareArguments` runs
 * before execute, so execute only sees canonical fields.
 */
export async function remindCanonicalToolForm(
  context: AfterToolCallContext,
): Promise<AfterToolCallResult | undefined> {
  if (context.isError) {
    return undefined;
  }
  const reminder = buildAliasReminder(context.toolCall.name, context.toolCall.arguments);
  if (!reminder) {
    return undefined;
  }
  const reminded = appendToolResultReminder(context.result, reminder);
  if (
    typeof reminded !== 'object'
    || reminded === null
    || !('content' in reminded)
    || !Array.isArray(reminded.content)
  ) {
    return undefined;
  }
  return { content: reminded.content as AfterToolCallResult['content'] };
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
      return await spec.execute(toolCallId, params, signal) as AgentToolResult<unknown>;
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
        execute: live.execute,
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
    // Pi 0.86 declares tools through transcript system messages instead of
    // Context.tools. Resolve the replayed declarations, and when silent aliases
    // are present, rebuild the transcript with a collapsed leading system
    // message that declares only the live tools.
    const declared = getCurrentTools(context.messages);
    if (declared.length === 0) {
      return streamFn(model, context, options);
    }
    const filtered = filterPromptFacingPiTools(declared);
    if (filtered.length === declared.length) {
      return streamFn(model, context, options);
    }
    const rebuilt = normalizeContext({
      systemPrompt: getCurrentSystemPrompt(context.messages),
      messages: withoutInitialSystemMessage([...context.messages]),
      tools: filtered,
    });
    return streamFn(model, rebuilt, options);
  };
}
