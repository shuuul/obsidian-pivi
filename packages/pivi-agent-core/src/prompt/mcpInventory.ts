export interface McpInventoryTool {
  name: string;
  description?: string;
}

export interface McpInventoryServer {
  name: string;
  tools: readonly McpInventoryTool[];
}

const MAX_TOOL_DESCRIPTION = 80;

function truncateDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_TOOL_DESCRIPTION) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_TOOL_DESCRIPTION - 1)}…`;
}

/**
 * Build concise MCP inventory lines for system/turn prompts.
 * Lists enabled server names and cached tool names; never dumps schemas.
 */
export function buildMcpInventoryLines(
  servers: readonly McpInventoryServer[],
): string[] {
  if (servers.length === 0) {
    return [];
  }

  const lines = [
    'Enabled MCP servers (discover/call via the `mcp` tool; optional `/server` slash tokens are emphasis only):',
  ];

  for (const server of servers) {
    if (server.tools.length === 0) {
      lines.push(
        `- \`${server.name}\` (tool list not cached yet — call \`mcp\` with \`server="${server.name}"\` to list)`,
      );
      continue;
    }

    const toolList = server.tools
      .map((tool) => {
        const desc = tool.description ? truncateDescription(tool.description) : '';
        return desc ? `\`${tool.name}\` (${desc})` : `\`${tool.name}\``;
      })
      .join(', ');
    lines.push(`- \`${server.name}\`: ${toolList}`);
  }

  return lines;
}
