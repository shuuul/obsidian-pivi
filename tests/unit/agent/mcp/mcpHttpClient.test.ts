import { connectMcpHttpClient } from '@pivi/agent/mcp/mcpHttpClient';

interface JsonRpcRequest {
  id?: number;
  method: string;
}

/** Minimal Streamable HTTP server answering with JSON bodies. */
function createServerFetch(): jest.Mock {
  return jest.fn(async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === 'GET') {
      return new Response(null, { status: 405 });
    }
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 200 });
    }
    const request = JSON.parse(String(init?.body)) as JsonRpcRequest;
    if (request.id === undefined) {
      return new Response(null, { status: 202 });
    }
    const result = request.method === 'initialize'
      ? {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '2.0.0' },
      }
      : request.method === 'tools/list'
        ? { tools: [{ name: 'search', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'hit' }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
    });
  });
}

describe('connectMcpHttpClient', () => {
  it('initializes over the injected fetch with configured headers', async () => {
    const fetch = createServerFetch();

    const { client, initialize } = await connectMcpHttpClient('pivi-test', {
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Api-Key': 'key' },
      fetch,
    });

    expect(initialize.serverInfo).toEqual({ name: 'fixture', version: '2.0.0' });
    await expect(client.listTools()).resolves.toEqual([{ name: 'search', inputSchema: { type: 'object' } }]);
    await expect(client.callTool('search', { q: 'x' })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'hit' }],
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Api-Key')).toBe('key');
    await client.close();
  });

  it('rejects immediately for an already aborted signal', async () => {
    const fetch = createServerFetch();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      connectMcpHttpClient('pivi-test', { url: 'https://mcp.example.com/mcp', fetch }, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(fetch).not.toHaveBeenCalled();
  });
});
