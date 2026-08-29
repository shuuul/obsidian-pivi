import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { gzipSync } from 'zlib';

import { OriginGrantRegistry } from '@pivi/agent/network';
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

async function listenWithoutTlsHandshake(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
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

  it('pins the public address when lookup also returns a private ULA', async () => {
    let calls = 0;
    const fetchImpl = createScopedFetch({
      policy: { purpose: 'provider' },
      lookup: async () => {
        calls += 1;
        return calls === 1
          ? ['1.2.3.4', 'fd12:3456:789a::1']
          : ['fd12:3456:789a::1'];
      },
    });
    await expect(fetchImpl('https://auth.kimi.com/api/oauth/device_authorization'))
      .rejects.toThrow(/changed before connect|pin/i);
    expect(calls).toBe(2);
  });

  it('keeps the total deadline active until the response body completes', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 100);
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/`;
    grants.grant(url, 60_000, 'web-fetch');
    const fetchImpl = createScopedFetch({
      policy: {
        purpose: 'web-fetch',
        deadlines: { totalMs: 30, idleMs: 1_000 },
      },
      grants,
      lookup: async () => ['127.0.0.1'],
    });
    const response = await fetchImpl(url);
    await expect(response.text()).rejects.toThrow(/Total deadline exceeded/i);
    await close();
  });

  it('completes a delayed body when totalMs is 0', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 80);
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { totalMs: 0, idleMs: 1_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });
      const response = await fetchImpl(url);
      await expect(response.text()).resolves.toBe('firstlate');
    } finally {
      await close();
    }
  });

  it('completes a delayed body when idleMs is 0', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 80);
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { totalMs: 5_000, idleMs: 0 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });
      const response = await fetchImpl(url);
      await expect(response.text()).resolves.toBe('firstlate');
    } finally {
      await close();
    }
  });

  it('applies one total deadline across redirects and the final body', async () => {
    const { port, close } = await listen((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { location: '/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 100);
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/start`;
    grants.grant(url, 60_000, 'web-fetch');
    const fetchImpl = createScopedFetch({
      policy: {
        purpose: 'web-fetch',
        deadlines: { totalMs: 30, idleMs: 1_000 },
      },
      grants,
      lookup: async () => ['127.0.0.1'],
    });
    const response = await fetchImpl(url);
    await expect(response.text()).rejects.toThrow(/Total deadline exceeded/i);
    await close();
  });

  it('cleans up abort listeners when the response body is cancelled', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
    });
    const grants = new OriginGrantRegistry();
    const url = `http://127.0.0.1:${port}/`;
    grants.grant(url, 60_000, 'web-fetch');
    const abort = new AbortController();
    const add = jest.spyOn(abort.signal, 'addEventListener');
    const remove = jest.spyOn(abort.signal, 'removeEventListener');
    const fetchImpl = createScopedFetch({
      policy: {
        purpose: 'web-fetch',
        signal: abort.signal,
        deadlines: { totalMs: 10_000, idleMs: 10_000 },
      },
      grants,
      lookup: async () => ['127.0.0.1'],
    });

    const response = await fetchImpl(url);
    await response.body?.cancel();
    abort.abort(new Error('late abort'));

    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    await close();
  });

  it('survives body idle longer than connectMs after headers arrive', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      // Node socket timeout is wall-clock inactivity; fake timers cannot arm it.
      window.setTimeout(() => res.end('second'), 80);
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 30, idleMs: 1_000, totalMs: 5_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });
      const response = await fetchImpl(url);
      await expect(response.text()).resolves.toBe('firstsecond');
    } finally {
      await close();
    }
  });

  it('uses firstByteMs after a fast connection instead of keeping connectMs armed', async () => {
    const { port, close } = await listen((_req, res) => {
      window.setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('delayed headers');
      }, 100);
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 40, firstByteMs: 400, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });

      const response = await fetchImpl(url);
      await expect(response.text()).resolves.toBe('delayed headers');
    } finally {
      await close();
    }
  });

  it('classifies missing response headers as a first-byte deadline', async () => {
    const { port, close } = await listen(() => undefined);
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 100, firstByteMs: 40, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });

      await expect(fetchImpl(url)).rejects.toThrow('First-byte deadline exceeded (40ms)');
    } finally {
      await close();
    }
  });

  it('keeps an incomplete HTTPS handshake in the connect phase', async () => {
    const { port, close } = await listenWithoutTlsHandshake();
    try {
      const grants = new OriginGrantRegistry();
      const url = `https://localhost:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 40, firstByteMs: 400, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
        agent: new https.Agent({ rejectUnauthorized: false }),
      });

      await expect(fetchImpl(url)).rejects.toThrow('Connect deadline exceeded (40ms)');
    } finally {
      await close();
    }
  });

  it('starts the first-byte phase immediately for a reused keep-alive socket', async () => {
    let connectionCount = 0;
    const { server, port, close } = await listen((req, res) => {
      if (req.url === '/second') {
        window.setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('second');
        }, 100);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('first');
    });
    server.on('connection', () => {
      connectionCount += 1;
    });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const grants = new OriginGrantRegistry();
      const baseUrl = `http://127.0.0.1:${port}`;
      grants.grant(baseUrl, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 40, firstByteMs: 400, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
        agent,
      });

      await expect((await fetchImpl(`${baseUrl}/first`)).text()).resolves.toBe('first');
      await expect((await fetchImpl(`${baseUrl}/second`)).text()).resolves.toBe('second');
      expect(connectionCount).toBe(1);
    } finally {
      agent.destroy();
      await close();
    }
  });

  it('gives each redirect hop its own first-byte budget', async () => {
    const { port, close } = await listen((req, res) => {
      window.setTimeout(() => {
        if (req.url === '/start') {
          res.writeHead(302, { location: '/final' });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('redirected');
      }, 30);
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/start`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 40, firstByteMs: 50, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });

      await expect((await fetchImpl(url)).text()).resolves.toBe('redirected');
    } finally {
      await close();
    }
  });

  it('preserves an explicit abort reason when it races a phase deadline', async () => {
    const { port, close } = await listen(() => undefined);
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const controller = new AbortController();
      const abortReason = new Error('user cancelled');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { connectMs: 100, firstByteMs: 50, totalMs: 2_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });
      const pending = fetchImpl(url, { signal: controller.signal });
      window.setTimeout(() => controller.abort(abortReason), 45);

      await expect(pending).rejects.toBe(abortReason);
    } finally {
      await close();
    }
  });

  it('normalizes mid-stream socket death to Connection closed prematurely', async () => {
    let killSocket: (() => void) | undefined;
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      // Defer destroy until the client has attached body listeners (after headers).
      killSocket = () => {
        res.socket?.destroy();
      };
    });
    try {
      const grants = new OriginGrantRegistry();
      const url = `http://127.0.0.1:${port}/`;
      grants.grant(url, 60_000, 'web-fetch');
      const fetchImpl = createScopedFetch({
        policy: {
          purpose: 'web-fetch',
          deadlines: { totalMs: 5_000, idleMs: 5_000 },
        },
        grants,
        lookup: async () => ['127.0.0.1'],
      });
      const response = await fetchImpl(url);
      const pending = response.text();
      killSocket?.();
      await expect(pending).rejects.toThrow('Connection closed prematurely');
    } finally {
      await close();
    }
  });
});
