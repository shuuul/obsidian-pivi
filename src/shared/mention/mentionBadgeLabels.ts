/** Visible label for a skill slash token (no leading `/`). */
export function formatSkillBadgeLabel(commandName: string): string {
  return commandName.startsWith('/') ? commandName.slice(1) : commandName;
}

/** Visible label for an MCP slash token (no leading `/`). */
export function formatMcpBadgeLabel(serverName: string, toolName?: string): string {
  return toolName ? `${serverName}/${toolName}` : serverName;
}
