import { createBrowserHttpClient } from '@/app/composition/mobile/browserHttpClient';

describe('createBrowserHttpClient', () => {
  it('adapts browser fetch into the HttpClient port', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    }));
    const client = createBrowserHttpClient(fetchImpl as unknown as typeof fetch);
    const response = await client.fetch({
      url: 'https://example.test/v1',
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: '{"a":1}',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/v1', expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: '{"a":1}',
    }));
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects declared and incrementally streamed oversized bodies', async () => {
    const declared = createBrowserHttpClient(
      jest.fn(async () => new Response('x', { headers: { 'content-length': '11' } })) as unknown as typeof fetch,
      { maxResponseBytes: 10 },
    );
    await expect(declared.fetch({ url: 'https://example.test' })).rejects.toThrow(/10-byte/);

    const streamed = createBrowserHttpClient(
      jest.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('123456'));
          controller.enqueue(new TextEncoder().encode('78901'));
          controller.close();
        },
      }))) as unknown as typeof fetch,
      { maxResponseBytes: 10 },
    );
    await expect(streamed.fetch({ url: 'https://example.test' })).rejects.toThrow(/10-byte/);
  });

  it('enforces a deadline and aborts the underlying fetch', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const client = createBrowserHttpClient(fetchImpl as unknown as typeof fetch, { deadlineMs: 25 });
    const pending = client.fetch({ url: 'https://example.test' });
    const rejection = pending.catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(25);
    expect(await rejection).toMatchObject({ name: 'TimeoutError' });
    expect(signal?.aborted).toBe(true);
    jest.useRealTimers();
  });

  it('cancels and releases a hanging response reader at the deadline', async () => {
    jest.useFakeTimers();
    const reader = {
      read: jest.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: jest.fn(() => Promise.resolve()),
      releaseLock: jest.fn(),
    };
    const response = {
      body: { getReader: () => reader },
      headers: new Headers(),
      ok: true,
      status: 200,
      statusText: 'OK',
    } as unknown as Response;
    const client = createBrowserHttpClient(
      jest.fn(async () => response) as unknown as typeof fetch,
      { deadlineMs: 25 },
    );
    const rejection = client.fetch({ url: 'https://example.test' }).catch(error => error);
    await jest.advanceTimersByTimeAsync(25);
    expect(await rejection).toMatchObject({ name: 'TimeoutError' });
    expect(reader.cancel).toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
