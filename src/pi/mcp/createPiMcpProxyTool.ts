import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { PiMcpBridge } from './PiMcpBridge';

const MCP_PROXY_PARAMETERS = {
  type: 'object',
  properties: {
    search: { type: 'string', description: 'Search tool names/descriptions across active servers' },
    server: { type: 'string', description: 'Server name to list tools or pair with tool/args' },
    tool: { type: 'string', description: 'Tool name to call on server' },
    args: { type: 'string', description: 'JSON object string of tool arguments' },
    describe: { type: 'string', description: 'Fully qualified tool name: server/tool' },
  },
  additionalProperties: false,
} as const;

interface McpProxyParams {
  search?: string;
  server?: string;
  tool?: string;
  args?: string;
  describe?: string;
}

function formatToolEntry(server: string, tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }): string {
  const lines = [`${server}/${tool.name}`];
  if (tool.description) {
    lines.push(`  ${tool.description}`);
  }
  if (tool.inputSchema && typeof tool.inputSchema === 'object') {
    const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        const description = value && typeof value === 'object' && 'description' in value
          ? String((value as { description?: unknown }).description ?? '')
          : '';
        lines.push(`  - ${key}${description ? `: ${description}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

function parseArgsJson(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('args must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function createPiMcpProxyTool(bridge: PiMcpBridge): AgentTool {
  return {
    name: 'mcp',
    label: 'MCP',
    description: [
      'Access vault-configured MCP servers (.obsius/mcp.json).',
      'Use search/list before calling tools. Servers with context-saving require a /server/tool token or toolbar enable.',
      'Modes: status (no params), search, server list, describe tool, call tool with args JSON string.',
    ].join(' '),
    parameters: MCP_PROXY_PARAMETERS,
    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as McpProxyParams;
      if (params.describe) {
        const [serverName, toolName] = params.describe.split('/', 2);
        if (!serverName || !toolName) {
          throw new Error('describe must be server/tool');
        }
        const tools = await bridge.listCachedTools(serverName);
        const match = tools.find((tool) => tool.name === toolName);
        if (!match) {
          throw new Error(`Tool not found: ${params.describe}`);
        }
        return {
          content: [{ type: 'text', text: formatToolEntry(serverName, match) }],
          details: { server: serverName, tool: toolName },
        };
      }

      if (params.tool) {
        const serverName = params.server?.trim();
        if (!serverName) {
          throw new Error('server is required when calling tool');
        }
        const args = parseArgsJson(params.args);
        const text = await bridge.callTool(serverName, params.tool, args, signal);
        return {
          content: [{ type: 'text', text }],
          details: { server: serverName, tool: params.tool },
        };
      }

      if (params.search) {
        const active = bridge.getActiveServers();
        await Promise.all(active.map((server) => bridge.listCachedTools(server.name)));
        const matches = bridge.searchTools(params.search);
        if (matches.length === 0) {
          return {
            content: [{ type: 'text', text: `No MCP tools matched "${params.search}".` }],
            details: { count: 0 },
          };
        }
        const text = matches
          .slice(0, 40)
          .map(({ server, tool }) => formatToolEntry(server, tool))
          .join('\n\n');
        return {
          content: [{ type: 'text', text }],
          details: { count: matches.length },
        };
      }

      if (params.server) {
        const tools = await bridge.listCachedTools(params.server);
        if (tools.length === 0) {
          return {
            content: [{ type: 'text', text: `No tools available for server "${params.server}".` }],
            details: { server: params.server, count: 0 },
          };
        }
        const text = tools.map((tool) => formatToolEntry(params.server!, tool)).join('\n\n');
        return {
          content: [{ type: 'text', text }],
          details: { server: params.server, count: tools.length },
        };
      }

      const summaries = bridge.getServerSummaries();
      const active = bridge.getActiveServers().map((server) => server.name);
      const lines = [
        `MCP servers (vault: .obsius/mcp.json): ${summaries.filter((s) => s.enabled).length} enabled`,
        `Active this turn: ${active.length > 0 ? active.join(', ') : '(none — use /server/tool or enable in toolbar)'}`,
        '',
        ...summaries.map((server) => {
          const flags = [
            server.enabled ? 'on' : 'off',
            server.contextSaving ? 'context-saving' : 'always-on',
          ].join(', ');
          return `- ${server.name} [${flags}]${server.toolCount > 0 ? ` (${server.toolCount} tools cached)` : ''}`;
        }),
      ];
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: { servers: summaries.length, active: active.length },
      };
    },
  };
}
