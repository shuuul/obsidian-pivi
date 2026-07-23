import { isValidMcpServerName, validateMcpRemoteUrl } from './mcpValidation';
import { normalizeMcpStoredValueMap } from './mcpValueSources';
import type { McpServerConfig, ParsedMcpConfig } from './types';
import { getMcpServerType, isValidMcpServerConfig } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeImportedServer(
  name: string,
  config: McpServerConfig,
): { name: string; config: McpServerConfig } | null {
  if (!isValidMcpServerName(name)) {
    return null;
  }
  if (getMcpServerType(config) === 'stdio') {
    return { name, config };
  }
  try {
    const remote = config as { url: string; type?: 'sse' | 'http'; headers?: unknown };
    const url = validateMcpRemoteUrl(remote.url);
    const headers = normalizeMcpStoredValueMap(remote.headers);
    if (remote.type === 'sse') {
      return { name, config: { type: 'sse', url, ...(headers ? { headers } : {}) } };
    }
    return { name, config: { type: 'http', url, ...(headers ? { headers } : {}) } };
  } catch {
    return null;
  }
}

function pushImportedServer(
  servers: Array<{ name: string; config: McpServerConfig }>,
  name: string,
  config: McpServerConfig,
): void {
  const normalized = normalizeImportedServer(name, config);
  if (normalized) {
    servers.push(normalized);
  }
}

/**
 * Parse pasted JSON (supports multiple formats).
 *
 * Formats supported:
 * 1. MCP standard format: { "mcpServers": { "name": {...} } }
 * 2. Single server with name: { "name": { "command": "..." } }
 * 3. Single server without name: { "command": "..." }
 * 4. Multiple named servers: { "server1": {...}, "server2": {...} }
 */
export function parseClipboardConfig(json: string): ParsedMcpConfig {
  try {
    const parsed: unknown = JSON.parse(json);

    if (!isRecord(parsed)) {
      throw new Error('Invalid JSON object');
    }

    // Format 1: MCP standard format
    // { "mcpServers": { "server-name": { "command": "...", ... } } }
    if (isRecord(parsed.mcpServers)) {
      const servers: Array<{ name: string; config: McpServerConfig }> = [];

      for (const [name, config] of Object.entries(parsed.mcpServers)) {
        if (isValidMcpServerConfig(config)) {
          pushImportedServer(servers, name, config);
        }
      }

      if (servers.length === 0) {
        throw new Error('No valid server configs found in mcpServers');
      }

      return { servers, needsName: false };
    }

    // Format 2: Single server config without name
    // { "command": "...", "args": [...] } or { "type": "sse", "url": "..." }
    if (isValidMcpServerConfig(parsed)) {
      return {
        servers: [{ name: '', config: parsed }],
        needsName: true,
      };
    }

    // Format 3: Single named server
    // { "server-name": { "command": "...", ... } }
    const entries = Object.entries(parsed);
    const entry = entries[0];
    if (entry) {
      const [name, config] = entry;
      if (isValidMcpServerConfig(config)) {
        const normalized = normalizeImportedServer(name, config);
        if (!normalized) {
          throw new Error('Invalid MCP configuration format');
        }
        return {
          servers: [normalized],
          needsName: false,
        };
      }
    }

    // Format 4: Multiple named servers (without mcpServers wrapper)
    // { "server1": {...}, "server2": {...} }
    const servers: Array<{ name: string; config: McpServerConfig }> = [];
    for (const [name, config] of entries) {
      if (isValidMcpServerConfig(config)) {
        pushImportedServer(servers, name, config);
      }
    }

    if (servers.length > 0) {
      return { servers, needsName: false };
    }

    throw new Error('Invalid MCP configuration format');
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON', { cause: error });
    }
    throw error;
  }
}

/**
 * Try to parse clipboard content as MCP config.
 * Returns null if not valid MCP config.
 */
export function tryParseClipboardConfig(text: string): ParsedMcpConfig | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    return parseClipboardConfig(trimmed);
  } catch {
    return null;
  }
}
