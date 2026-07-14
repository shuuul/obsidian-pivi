import type { SettingsComplexPorts } from '../../ports';
import { useMcpTabState } from './useMcpTabState';

export type McpPorts = SettingsComplexPorts['mcp'];

export { McpServerEditor } from './McpServerEditor';
export {
  buildMcpServer,
  MCP_SERVER_NAME_PATTERN,
  type McpDraft,
  mcpDraftFrom,
  mcpDraftFromLines,
  mcpDraftToLines,
  mcpErrorText,
} from './useMcpTabState';
export { useMcpTabState } from './useMcpTabState';

export function useMcpTab(mcp: McpPorts) {
  return useMcpTabState(mcp);
}
