import * as legacySseModule from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport';

export type LegacySseTransportOptions = {
  fetch?: typeof fetch;
  requestInit?: RequestInit;
};

type LegacySseTransportConstructor = new (
  url: URL,
  options?: LegacySseTransportOptions,
) => Transport;

/**
 * MCP SDK deprecated SSE transport for servers that do not support streamable HTTP.
 */
export function createLegacySseTransport(url: URL, options: LegacySseTransportOptions = {}): Transport {
  // The MCP SDK intentionally keeps this deprecated transport available while
  // servers migrate to streamable HTTP; Pivi only reaches it for explicit SSE configs.
  const TransportConstructor = (legacySseModule as Record<string, unknown>)[
    'SSEClientTransport'
  ] as LegacySseTransportConstructor;
  return new TransportConstructor(url, options);
}
