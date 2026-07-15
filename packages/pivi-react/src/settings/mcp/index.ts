import type { SettingsComplexPorts } from '../../ports';
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
} from './useMcpSectionState';
export { useMcpSectionState } from './useMcpSectionState';
