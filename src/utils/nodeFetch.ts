import * as http from 'http';
import * as https from 'https';

interface MinimalFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

const DEFAULT_NODE_FETCH_USER_AGENT = 'Mozilla/5.0 Pivi/0.2.2';

export function applyNodeFetchDefaultHeaders(headers: Headers): void {
  if (!headers.has('user-agent')) {
    headers.set('user-agent', DEFAULT_NODE_FETCH_USER_AGENT);
  }
  if (!headers.has('accept')) {
    headers.set('accept', '*/*');
  }
}

function createFetchResponse(res: http.IncomingMessage): MinimalFetchResponse {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        responseHeaders.append(key, headerValue);
      }
    } else {
      responseHeaders.append(key, value);
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      res.on('data', (chunk: Buffer | string) => {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buffer));
      });
      res.on('end', () => controller.close());
      res.on('error', (error: Error) => controller.error(error));
    },
    cancel(reason?: unknown) {
      res.destroy(reason instanceof Error ? reason : new Error('Response body cancelled'));
    },
  });

  let bodyUsed = false;
  const readAsText = async (): Promise<string> => {
    if (bodyUsed) {
      throw new TypeError('Body has already been consumed');
    }
    bodyUsed = true;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  };

  return {
    ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
    status: res.statusCode ?? 500,
    statusText: res.statusMessage ?? '',
    headers: responseHeaders,
    body,
    text: readAsText,
    json: async () => {
      const parsed: unknown = JSON.parse(await readAsText());
      return parsed;
    },
  };
}

function getRequestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === 'string') {
    return new URL(input);
  }
  return new URL(input.url);
}

function mergeHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

async function getRequestBody(body: BodyInit | null | undefined): Promise<Buffer | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }

  const serialized = await new Response(body).arrayBuffer();
  return Buffer.from(serialized);
}

/**
 * Node HTTP fetch for Obsidian's Electron renderer.
 * Cross-origin browser fetch often fails with a generic "Connection error." for LLM APIs.
 */
export function createNodeFetch(): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = getRequestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = mergeHeaders(input, init);
    applyNodeFetchDefaultHeaders(headers);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const body = await getRequestBody(init?.body ?? (input instanceof Request ? input.body : undefined));
    const transport = requestUrl.protocol === 'https:' ? https : http;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const onAbort = () => {
        req.destroy(new Error('Request aborted'));
        fail(signal?.reason ?? new Error('Request aborted'));
      };

      const requestHeaders: Record<string, string> = {};
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
      if (body) {
        requestHeaders['content-length'] = String(body.byteLength);
      }

      const req = transport.request(
        requestUrl,
        {
          method,
          headers: requestHeaders,
        },
        (res: http.IncomingMessage) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(createFetchResponse(res) as Response);
        },
      );

      req.on('error', (error: Error) => fail(error));

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (body) {
        req.end(body);
      } else {
        req.end();
      }
    });
  };
}

let rendererFetchPatched = false;

/** Route pi-ai / OpenAI SDK HTTP through Node to avoid renderer CORS failures. */
export function patchRendererFetchForElectron(): void {
  if (rendererFetchPatched) {
    return;
  }
  rendererFetchPatched = true;
  window.fetch = createNodeFetch();
}

export const nodeFetch = createNodeFetch();
