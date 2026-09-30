import {
  type AuthProvider,
  type InitializeResult,
  McpClient,
  StreamableHttpTransport,
} from '@earendil-works/pi-mcp';

import type { McpTransportFetch } from './ports';

export interface McpHttpConnectionOptions {
  url: string;
  headers?: Record<string, string>;
  fetch: McpTransportFetch;
  authProvider?: AuthProvider;
}

export interface McpHttpConnection {
  client: McpClient;
  transport: StreamableHttpTransport;
  initialize: InitializeResult;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('MCP connection aborted');
}

/**
 * Connect a pi-mcp client over Streamable HTTP. `McpClient.connect` takes no
 * signal, so an abort closes the half-open client and rejects immediately.
 */
export async function connectMcpHttpClient(
  clientName: string,
  options: McpHttpConnectionOptions,
  signal?: AbortSignal,
): Promise<McpHttpConnection> {
  if (signal?.aborted) {
    throw abortError(signal);
  }
  const transport = new StreamableHttpTransport({
    url: options.url,
    fetch: options.fetch,
    ...(options.headers && Object.keys(options.headers).length > 0 ? { headers: options.headers } : {}),
    ...(options.authProvider ? { authProvider: options.authProvider } : {}),
  });
  // Match the 60 s per-request default Pivi had with the official SDK; pi-mcp defaults to 30 s.
  const client = new McpClient({ name: clientName, version: '1.0.0', requestTimeoutMs: 60_000 });

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);

  try {
    const initialize = await Promise.race([client.connect(transport), aborted]);
    return { client, transport, initialize };
  } catch (error) {
    await Promise.allSettled([client.close(), transport.close()]);
    throw error;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
