import { Agent, type AgentMessage, type AgentTool, type StreamFn, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { McpOAuthService, McpServerManager } from '@pivi/agent/mcp';
import { McpToolBridge } from '@pivi/agent/mcp';
import type { CapabilityApprovalPort } from '@pivi/agent/ports/capabilityApproval';
import type { PreparedChatTurn } from '@pivi/agent/runtime/types';
import type { ReadAllowanceReservation } from '@pivi/agent/runtime/usage';
import { TOOL_SPAWN_AGENT } from '@pivi/agent/tools';

import { streamPiAiModelsSimple } from '../models/piAiModels';
import type { PiResolvedModel } from '../models/piModelRegistry';
import { sanitizeAgentMessagesForLlm } from '../session/agentMessageHistory';
import type { PiBaseToolProvider } from '../tools/buildPiToolRegistryCore';
import { remindCanonicalToolForm, toPiAgentTool, wrapStreamFnToHideAliasTools } from '../tools/piToolAdapter';
import type { ActiveTurn } from './piChatRuntimeActiveTurn';
import type { PiChatRuntimeNetwork } from './piChatRuntimeTypes';
import { toPiImageContent } from './piImageContent';

/**
 * Tools for a subagent. Intentionally takes only the base tool provider (+ MCP):
 * the main-only provider is never passed in, so management tools cannot appear
 * in subagent inventory, and subagents never receive `spawn_agent`.
 */
export function buildSubagentAgentTools(options: {
  vaultPath: string | null;
  baseToolProvider: PiBaseToolProvider | null;
  mcpBridge: McpToolBridge | null;
  externalContextPaths: string[];
  capabilityApproval: CapabilityApprovalPort | null;
  resolveReadMaxChars: (requestedMaxChars?: number) => ReadAllowanceReservation;
}): AgentTool[] {
  const { vaultPath, baseToolProvider } = options;
  if (!vaultPath || !baseToolProvider) {
    return [];
  }
  const providedBaseTools = baseToolProvider({
    vaultPath,
    externalContextPaths: options.externalContextPaths,
    resolveReadMaxChars: options.resolveReadMaxChars,
    capabilityApproval: options.capabilityApproval,
  });
  const baseTools = providedBaseTools.toolSpecs
    .map(toPiAgentTool)
    .filter((tool) => tool.name !== TOOL_SPAWN_AGENT);
  const mcpTools = options.mcpBridge?.getToolSpecs()
    .map(toPiAgentTool)
    .filter((tool) => tool.name !== TOOL_SPAWN_AGENT) ?? [];
  return [...baseTools, ...mcpTools];
}

/** Construct the in-process Pi agent for a chat session. `streamFn` replaces the shared pi-ai stream entry when set. */
export function createChatAgent(options: {
  model: PiResolvedModel;
  systemPrompt: string;
  tools: AgentTool[];
  messages: AgentMessage[];
  thinkingLevel: ThinkingLevel;
  streamFn?: StreamFn;
  sessionId?: string;
}): Agent {
  return new Agent({
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      messages: options.messages,
      thinkingLevel: options.thinkingLevel,
    },
    convertToLlm: (messages) => sanitizeAgentMessagesForLlm(messages),
    streamFn: wrapStreamFnToHideAliasTools(
      options.streamFn
        ?? ((streamModel, context, streamOptions) => streamPiAiModelsSimple(streamModel, context, streamOptions)),
    ),
    afterToolCall: remindCanonicalToolForm,
    sessionId: options.sessionId,
    steeringMode: 'one-at-a-time',
  });
}

/** Queue a steering turn on the running agent; false when no turn is live to steer. */
export function steerActiveTurn(
  activeTurn: ActiveTurn | null,
  agent: Agent | null,
  turn: PreparedChatTurn,
): boolean {
  if (
    !activeTurn
    || activeTurn.abortController.signal.aborted
    || !agent?.signal
    || agent.signal.aborted
  ) {
    return false;
  }
  activeTurn.steeredTurns.push(turn);
  const images = toPiImageContent(turn.request.images);
  agent.steer({
    role: 'user',
    // Mirror agent.prompt(text, images): text-only stays a string; attachments use content blocks.
    content: images.length > 0
      ? [{ type: 'text', text: turn.prompt }, ...images]
      : turn.prompt,
    timestamp: Date.now(),
  });
  return true;
}

export function createMcpToolBridge(
  mcpManager: McpServerManager | null,
  mcpOAuth: McpOAuthService | null,
  network: PiChatRuntimeNetwork,
): McpToolBridge | null {
  return mcpManager
    ? new McpToolBridge(
      mcpManager,
      mcpOAuth,
      network.mcpFetch,
      network.mcpProcessEnv,
      network.mcpSecretStorage,
    )
    : null;
}
