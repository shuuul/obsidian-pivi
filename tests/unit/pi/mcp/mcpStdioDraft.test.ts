import {
  formatMcpArgsLines,
  parseMcpArgsLines,
} from '@pivi/pivi-agent-core/mcp/mcpUtils';
import {
  assertValidMcpServerName,
  validateMcpRemoteUrl,
} from '@pivi/pivi-agent-core/mcp/mcpValidation';
import type { McpStdioServerConfig } from '@pivi/pivi-agent-core/mcp/types';

function buildStdioConfig(
  executable: string,
  argsText: string,
): McpStdioServerConfig {
  const command = executable.trim();
  const args = parseMcpArgsLines(argsText);
  return {
    command,
    ...(args.length > 0 ? { args } : {}),
  };
}

describe('stdio MCP argument round-trip', () => {
  it('preserves executable and argument array without shell reparsing', () => {
    const args = ['--name', 'hello world', '', 'C:\\Program Files\\tool'];
    const config = buildStdioConfig(' /usr/bin/mcp ', formatMcpArgsLines(args));

    expect(config).toEqual({
      command: '/usr/bin/mcp',
      args,
    });

    const roundTrip = buildStdioConfig(config.command, formatMcpArgsLines(config.args));
    expect(roundTrip).toEqual(config);
    expect(assertValidMcpServerName('local')).toBe('local');
    expect(() => validateMcpRemoteUrl('http://example.test/mcp')).toThrow();
  });
});
