import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
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
  const TransportConstructor = SSEClientTransport as LegacySseTransportConstructor;
  return new TransportConstructor(url, options);
}
