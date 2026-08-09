import { buildTurnPrompt, finalizeTurnPrompt } from '../prompt/buildTurnPrompt';
import type { AgentCoreMcpServices } from './agentCoreHost';
import type { ChatTurnRequest, PreparedChatTurn } from './types';

type McpMentionOps = Required<Pick<AgentCoreMcpServices, 'extractMentions' | 'transformMentions'>>;

function getMcpMentionOps(mcp: AgentCoreMcpServices | null | undefined): McpMentionOps | null {
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
  mcp?: AgentCoreMcpServices | null,
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
