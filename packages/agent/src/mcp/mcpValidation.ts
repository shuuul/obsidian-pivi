/** MCP server name, URL, and map-key validation shared by storage, import, and UI. */

export const RESERVED_MCP_SERVER_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type McpValidationErrorCode =
  | 'serverNameRequired'
  | 'serverNameInvalid'
  | 'serverNameReserved'
  | 'urlRequired'
  | 'urlInvalid'
  | 'urlScheme'
  | 'urlPlainHttp'
  | 'commandRequired'
  | 'commandShellSyntax';

export class McpValidationError extends Error {
  readonly code: McpValidationErrorCode;

  constructor(code: McpValidationErrorCode, message: string) {
    super(message);
    this.name = 'McpValidationError';
    this.code = code;
  }
}

export function isReservedMcpServerName(name: string): boolean {
  return RESERVED_MCP_SERVER_NAMES.has(name);
}

export function isValidMcpServerName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0
    && MCP_SERVER_NAME_PATTERN.test(trimmed)
    && !isReservedMcpServerName(trimmed);
}

export function assertValidMcpServerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new McpValidationError('serverNameRequired', 'MCP server name is required');
  }
  if (isReservedMcpServerName(trimmed)) {
    throw new McpValidationError(
      'serverNameReserved',
      `MCP server name "${trimmed}" is reserved`,
    );
  }
  if (!MCP_SERVER_NAME_PATTERN.test(trimmed)) {
    throw new McpValidationError(
      'serverNameInvalid',
      'MCP server name can only contain letters, numbers, dots, hyphens, and underscores',
    );
  }
  return trimmed;
}

function isLoopbackHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered === '::1') {
    return true;
  }
  if (lowered === '127.0.0.1' || lowered.startsWith('127.')) {
    return true;
  }
  return false;
}

/** Returns a normalized remote MCP URL or throws `McpValidationError`. */
export function validateMcpRemoteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new McpValidationError('urlRequired', 'MCP server URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new McpValidationError('urlInvalid', 'MCP server URL is not valid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpValidationError(
      'urlScheme',
      'MCP server URL must use http or https',
    );
  }

  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new McpValidationError(
      'urlPlainHttp',
      'Plain HTTP MCP URLs are allowed only for loopback hosts',
    );
  }

  return parsed.toString();
}

export function createMcpServerMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function setMcpServerMapEntry<T>(
  map: Record<string, T>,
  name: string,
  value: T,
): void {
  assertValidMcpServerName(name);
  map[name] = value;
}

const MCP_STDIO_SHELL_CONTROL = /[;&|<>`]|[$][(]|[$][{]|\r|\n/;

/**
 * Stdio MCP must receive a resolved executable path/name, not a shell string.
 * Argument vectors are separate; shell control characters in the command are rejected.
 */
export function assertMcpStdioExecutable(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new McpValidationError('commandRequired', 'MCP stdio executable is required');
  }
  if (MCP_STDIO_SHELL_CONTROL.test(trimmed)) {
    throw new McpValidationError(
      'commandShellSyntax',
      'MCP stdio executable must not contain shell control syntax',
    );
  }
  return trimmed;
}
