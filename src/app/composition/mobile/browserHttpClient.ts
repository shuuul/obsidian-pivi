import type { HttpClient, HttpRequest, HttpResponse } from '@pivi/pivi-agent-core/ports';

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_DEADLINE_MS = 30_000;

export interface BrowserHttpClientOptions {
  maxResponseBytes?: number;
  deadlineMs?: number;
}

function limitError(maxBytes: number): Error {
  return new Error(`HTTP response exceeds the ${maxBytes}-byte client limit.`);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw limitError(maxBytes);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
    release();
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectWithAbort = () => reject(signal.reason instanceof Error
      ? signal.reason
      : new DOMException('HTTP request aborted.', 'AbortError'));
    if (signal.aborted) rejectWithAbort();
    else signal.addEventListener('abort', rejectWithAbort, { once: true });
  });
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const read = reader.read();
      const { done, value } = await Promise.race([read, aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw limitError(maxBytes);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    release();
  }
}

/**
 * Minimal browser HttpClient for PiChatRuntime connectivity/non-stream paths.
 * Provider streaming continues through the separate browser fetch transport.
 */
export function createBrowserHttpClient(
  fetchImpl: typeof fetch = globalThis.fetch,
  options: BrowserHttpClientOptions = {},
): HttpClient {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  return {
    async fetch(request: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      let timeout: number | undefined;
      const init: RequestInit = {
        method: request.method ?? 'GET',
        headers: request.headers,
        signal: controller.signal,
      };
      if (typeof request.body === 'string') {
        init.body = request.body;
      } else if (request.body) {
        init.body = request.body.buffer.slice(
          request.body.byteOffset,
          request.body.byteOffset + request.body.byteLength,
        ) as ArrayBuffer;
      }
      try {
        const operation = (async (): Promise<HttpResponse> => {
          const response = await fetchImpl(request.url, init);
          const text = await readBoundedBody(response, maxResponseBytes, controller.signal);
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            text: () => Promise.resolve(text),
            json: <T = unknown>() => Promise.resolve(JSON.parse(text) as T),
          };
        });
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(() => {
            controller.abort();
            reject(new DOMException(
              `HTTP request exceeded its ${deadlineMs}ms deadline.`,
              'TimeoutError',
            ));
          }, deadlineMs);
        });
        return await Promise.race([operation(), deadline]);
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        controller.abort();
      }
    },
  };
}
