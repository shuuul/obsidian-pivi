import * as http from 'http';
import { gzipSync } from 'zlib';

import { OriginGrantRegistry } from '@pivi/pivi-agent-core/network';
import { createScopedFetch } from '@pivi/obsidian-host/scopedHttpClient';

async function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  return {
    server,
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

describe('scopedHttpClient', () => {
  it('denies loopback by default and allows an origin grant', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    const url = `http://127.0.0.1:${port}/`;
    const grants = new OriginGrantRegistry();
    const denied = createScopedFetch({
      policy: { purpose: 'web-fetch' },
      lookup: async () => ['127.0.0.1'],
    });
    await expect(denied(url)).rejects.toThrow(/denied|loopback/i);

    grants.grant(url, 60_000, 'web-fetch');
    const allowed = createScopedFetch({
      policy: { purpose: 'web-fetch' },
      grants,
      lookup: async () => ['127.0.0.1'],
    });
    const response = await allowed(url);
    expect(await response.text()).toBe('ok');
    await close();
  });

  it('rechecks redirects and rejects private redirect targets', async () => {
    const { port, close } = await listen((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: 'http://10.0.0.1/secret' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('should-not-reach');
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/start`;
    grants.grant(url, 60_000, 'web-fetch');
    const fetchImpl = createScopedFetch({
      policy: { purpose: 'web-fetch' },
      grants,
      lookup: async (hostname) => (hostname === '10.0.0.1' ? ['10.0.0.1'] : ['127.0.0.1']),
    });
    await expect(fetchImpl(url)).rejects.toThrow(/denied|private/i);
    await close();
  });

  it('enforces encoded and decoded byte limits against compressed expansion', async () => {
    const payload = Buffer.alloc(200_000, 0x61);
    const compressed = gzipSync(payload);
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
      });
      res.end(compressed);
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/`;
    grants.grant(url, 60_000, 'web-fetch');
    const fetchImpl = createScopedFetch({
      policy: {
        purpose: 'web-fetch',
        byteLimits: {
          maxEncodedResponseBytes: 1024 * 1024,
          maxDecodedResponseBytes: 50_000,
        },
      },
      grants,
      lookup: async () => ['127.0.0.1'],
    });
    const response = await fetchImpl(url);
    await expect(response.text()).rejects.toThrow(/Decoded response exceeds limit/i);
    await close();
  });

  it('rejects disallowed content types and URL credentials', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end('bin');
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/`;
    grants.grant(url, 60_000, 'web-fetch');
    const fetchImpl = createScopedFetch({
      policy: {
        purpose: 'web-fetch',
        allowedContentTypes: ['text/plain'],
      },
      grants,
      lookup: async () => ['127.0.0.1'],
    });
    await expect(fetchImpl(url)).rejects.toThrow(/content type/i);
    await expect(fetchImpl(`http://user:pass@127.0.0.1:${port}/`)).rejects.toThrow(/credentials/i);
    await close();
  });

  it('detects DNS resolution changes between validation and connect', async () => {
    let calls = 0;
    const fetchImpl = createScopedFetch({
      policy: { purpose: 'web-fetch', allowPrivateNetwork: true },
      lookup: async () => {
        calls += 1;
        return calls === 1 ? ['1.2.3.4'] : ['10.0.0.1'];
      },
    });
    await expect(fetchImpl('https://example.test/')).rejects.toThrow(/changed before connect|pin/i);
  });
});
