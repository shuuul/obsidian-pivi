import { buildTurnPrompt, finalizeTurnPrompt } from '../prompt/buildTurnPrompt';
import type { ChatTurnRequest, PreparedChatTurn } from './types';

/** MCP mention hooks; a manager lacking either one leaves the prompt untransformed. */
export interface McpMentionServices {
  extractMentions?(content: string): Set<string>;
  transformMentions?(content: string): string;
}

type McpMentionOps = Required<McpMentionServices>;

function getMcpMentionOps(mcp: McpMentionServices | null | undefined): McpMentionOps | null {
  if (!mcp?.extractMentions || !mcp.transformMentions) {
    return null;
  }
  return {
    extractMentions: mcp.extractMentions.bind(mcp),
    transformMentions: mcp.transformMentions.bind(mcp),
  };
}

function mergeMcpMentions(
  mentions: Set<string>,
  enabledMcpServers?: Set<string>,
): Set<string> {
  if (!enabledMcpServers || enabledMcpServers.size === 0) {
    return mentions;
  }
  return new Set([...mentions, ...enabledMcpServers]);
}

export function prepareChatTurn(
  request: ChatTurnRequest,
  mcp?: McpMentionServices | null,
): PreparedChatTurn {
  const built = buildTurnPrompt(request);
  const finalized = finalizeTurnPrompt(built, request, getMcpMentionOps(mcp));
  return {
    displayContent: request.text,
    isCompact: built.isCompact,
    mcpMentions: mergeMcpMentions(finalized.mcpMentions, request.enabledMcpServers),
    persistedContent: finalized.persistedContent,
    prompt: finalized.prompt,
    request,
  };
}
