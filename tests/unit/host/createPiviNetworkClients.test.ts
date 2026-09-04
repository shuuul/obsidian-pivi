import * as http from 'http';

import { createPiviNetworkClients } from '@pivi/obsidian-host/createPiviNetworkClients';

async function listen(
  handler: http.RequestListener,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

describe('createPiviNetworkClients', () => {
  it('applies setProviderDeadlines to later providerFetch requests without recreating clients', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 80);
    });
    try {
      const clients = createPiviNetworkClients();
      const url = `http://127.0.0.1:${port}/`;
      clients.grants.grant(url, 60_000, 'provider');

      clients.setProviderDeadlines({ totalMs: 30, idleMs: 1_000 });
      await expect(clients.providerFetch(url).then((response) => response.text()))
        .rejects.toThrow(/Total deadline exceeded/i);

      clients.setProviderDeadlines({ totalMs: Number.NaN, idleMs: -1 });
      await expect(clients.providerFetch(url).then((response) => response.text()))
        .rejects.toThrow(/Total deadline exceeded/i);

      clients.setProviderDeadlines({ totalMs: 0, idleMs: 1_000 });
      await expect((await clients.providerFetch(url)).text()).resolves.toBe('firstlate');
    } finally {
      await close();
    }
  });

  it('lets setProviderDeadlines disable idleMs on subsequent providerFetch requests', async () => {
    const { port, close } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      window.setTimeout(() => res.end('late'), 80);
    });
    try {
      const clients = createPiviNetworkClients();
      const url = `http://127.0.0.1:${port}/`;
      clients.grants.grant(url, 60_000, 'provider');

      clients.setProviderDeadlines({ totalMs: 5_000, idleMs: 20 });
      await expect((await clients.providerFetch(url)).text())
        .rejects.toThrow(/Idle deadline exceeded/i);

      clients.setProviderDeadlines({ totalMs: 5_000, idleMs: 0 });
      await expect((await clients.providerFetch(url)).text()).resolves.toBe('firstlate');
    } finally {
      await close();
    }
  });
});
