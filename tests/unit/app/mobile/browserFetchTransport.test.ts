import { createBrowserFetchTransport } from '@/app/composition/mobile/browserFetchTransport';

describe('Mobile browser fetch transport', () => {
  it('preserves streaming chunk boundaries', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n'));
        controller.enqueue(new TextEncoder().encode('data: two\n'));
        controller.close();
      },
    });
    const nativeResponse = new Response(body, { status: 200 });
    const transport = createBrowserFetchTransport({ fetch: jest.fn().mockResolvedValue(nativeResponse) });
    const response = await transport('https://api.example.test/stream');
    const reader = response.body!.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: one\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: two\n');
  });

  it('passes cancellation to native fetch and preserves its abort error', async () => {
    const controller = new AbortController();
    const nativeFetch = jest.fn(async (_input, init: RequestInit | undefined) => {
      controller.abort();
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted with native details', 'AbortError');
    });
    const transport = createBrowserFetchTransport({ fetch: nativeFetch });

    await expect(transport('https://api.example.test', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', message: 'Provider request was aborted.' });
  });

  it('returns HTTP error responses without replacing status or body', async () => {
    const nativeResponse = new Response('rate limited', { status: 429, statusText: 'Too Many Requests' });
    const transport = createBrowserFetchTransport({ fetch: jest.fn().mockResolvedValue(nativeResponse) });

    const response = await transport('https://api.example.test');
    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe('rate limited');
  });

  it('redacts URL credentials, query, and fragment from network errors', async () => {
    const transport = createBrowserFetchTransport({
      fetch: jest.fn().mockRejectedValue(new Error('native failure with private details')),
    });

    await expect(transport('https://user:password@api.example.test/v1?key=sentinel#secret'))
      .rejects.toThrow('Provider request failed for https://api.example.test/v1');
    await expect(transport('https://user:password@api.example.test/v1?key=sentinel#secret'))
      .rejects.not.toThrow(/password|sentinel|private details/);
  });

  it('does not retain the native error anywhere on the thrown object', async () => {
    const secret = 'native-secret-sentinel';
    const native = new Error(`failure ${secret}`);
    (native as Error & { detail: string }).detail = secret;
    const transport = createBrowserFetchTransport({ fetch: jest.fn().mockRejectedValue(native) });
    let thrown: unknown;
    try {
      await transport('https://api.example.test');
    } catch (error) {
      thrown = error;
    }
    const error = thrown as Error & { cause?: unknown };
    expect(error.cause).toBeUndefined();
    expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain(secret);
  });
});
