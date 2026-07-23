/**
 * Scoped Node http(s) client with egress policy, DNS pinning, redirects,
 * deadlines, streaming byte limits, and a Fetch-compatible Response surface.
 */

import {
  assertDestinationAllowed,
  assertPinnedAddress,
  contentTypeAllowed,
  type DnsLookupFn,
  EgressPolicyError,
  type EgressPolicyOptions,
  filterRedirectHeaders,
  isLiteralIpHostname,
  NetworkUrlError,
  normalizeHttpUrl,
  type OriginGrantRegistry,
  prepareRedirect,
  redactUrl,
  type ResolvedEgressPolicy,
  resolveEgressPolicy,
} from '@pivi/pivi-agent-core/network';
import type { FetchCompatible, HttpClient, HttpRequest, HttpResponse } from '@pivi/pivi-agent-core/ports';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import type { Readable } from 'stream';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';

declare const __PIVI_RELEASE_VERSION__: string | undefined;

const DEFAULT_USER_AGENT = `Mozilla/5.0 Pivi/${typeof __PIVI_RELEASE_VERSION__ === 'string' ? __PIVI_RELEASE_VERSION__ : '0.0.0-dev'}`;

export function applyScopedHttpDefaultHeaders(headers: Headers): void {
  if (!headers.has('user-agent')) {
    headers.set('user-agent', DEFAULT_USER_AGENT);
  }
  if (!headers.has('accept')) {
    headers.set('accept', '*/*');
  }
}

export interface ScopedHttpClientOptions {
  policy: EgressPolicyOptions;
  grants?: OriginGrantRegistry;
  lookup?: DnsLookupFn;
  agent?: http.Agent | https.Agent | ((url: URL) => http.Agent | https.Agent | undefined);
}

interface RawHttpResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: Readable | null;
  remoteAddress?: string;
}

const defaultLookup: DnsLookupFn = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
};

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { signal, listener } of listeners) {
      signal.removeEventListener('abort', listener);
    }
    listeners.length = 0;
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      dispose();
      break;
    }
    const listener = () => {
      if (!controller.signal.aborted) {
        controller.abort(signal.reason);
      }
      dispose();
    };
    listeners.push({ signal, listener });
    signal.addEventListener('abort', listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

function createDeadlineSignal(ms: number, label: string): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort(new EgressPolicyError('deadline', `${label} deadline exceeded (${ms}ms)`));
  }, ms);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timer),
  };
}

async function readRequestBody(
  body: BodyInit | null | undefined,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (body === undefined || body === null) {
    return undefined;
  }
  const serialized = Buffer.from(await new Response(body).arrayBuffer());
  if (serialized.byteLength > maxBytes) {
    throw new EgressPolicyError(
      'byte-limit',
      `Request body exceeds limit (${serialized.byteLength} > ${maxBytes})`,
    );
  }
  return serialized;
}

function headersFromIncoming(res: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        headers.append(key, headerValue);
      }
    } else {
      headers.append(key, value);
    }
  }
  return headers;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function decompressBuffer(
  encoding: string | null,
  encoded: Buffer,
  maxDecoded: number,
): Buffer {
  if (!encoding || encoding === 'identity') {
    return encoded;
  }
  try {
    if (/br/i.test(encoding)) {
      return brotliDecompressSync(encoded, { maxOutputLength: maxDecoded });
    }
    if (/gzip|x-gzip/i.test(encoding)) {
      return gunzipSync(encoded, { maxOutputLength: maxDecoded });
    }
    if (/deflate/i.test(encoding)) {
      return inflateSync(encoded, { maxOutputLength: maxDecoded });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      (typeof error === 'object' && error !== null && 'code' in error
        && error.code === 'ERR_BUFFER_TOO_LARGE')
      || /maxOutputLength|larger than/i.test(errorMessage)
    ) {
      throw new EgressPolicyError(
        'byte-limit',
        `Decoded response exceeds limit (${maxDecoded} bytes)`,
      );
    }
    throw new EgressPolicyError(
      'byte-limit',
      `Failed to decompress response: ${errorMessage}`,
    );
  }
  return encoded;
}

function createLimitedBodyStream(
  source: Readable,
  limits: {
    maxEncoded: number;
    maxDecoded: number;
    encoding: string | null;
    idleMs: number;
    signal: AbortSignal;
  },
  onDone: () => void,
): ReadableStream<Uint8Array> {
  let encodedTotal = 0;
  let decodedTotal = 0;
  let idleTimer: number | undefined;
  const encodedChunks: Buffer[] = [];
  const isCompressed = Boolean(
    limits.encoding
    && limits.encoding !== 'identity'
    && /gzip|deflate|br/i.test(limits.encoding),
  );
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };
  let cancelBody = finish;

  const resetIdle = (fail: (error: Error) => void) => {
    if (idleTimer !== undefined) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      fail(new EgressPolicyError('deadline', `Idle deadline exceeded (${limits.idleMs}ms)`));
    }, limits.idleMs);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false;
      const cleanup = () => {
        if (idleTimer !== undefined) window.clearTimeout(idleTimer);
        limits.signal.removeEventListener('abort', onAbort);
        source.removeListener('data', onData);
        source.removeListener('end', onEnd);
        source.removeListener('error', fail);
        finish();
      };
      cancelBody = () => {
        if (settled) return;
        settled = true;
        cleanup();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        source.destroy();
        controller.error(error instanceof Error ? error : new Error(String(error)));
      };

      const onAbort = () => {
        fail(limits.signal.reason instanceof Error
          ? limits.signal.reason
          : new EgressPolicyError('aborted', 'Request aborted'));
      };

      const onData = (chunk: Buffer | string) => {
        if (settled) return;
        resetIdle(fail);
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        encodedTotal += buffer.byteLength;
        if (encodedTotal > limits.maxEncoded) {
          fail(new EgressPolicyError(
            'byte-limit',
            `Encoded response exceeds limit (${encodedTotal} > ${limits.maxEncoded})`,
          ));
          return;
        }
        if (isCompressed) {
          encodedChunks.push(buffer);
          return;
        }
        decodedTotal += buffer.byteLength;
        if (decodedTotal > limits.maxDecoded) {
          fail(new EgressPolicyError(
            'byte-limit',
            `Decoded response exceeds limit (${decodedTotal} > ${limits.maxDecoded})`,
          ));
          return;
        }
        controller.enqueue(new Uint8Array(buffer));
      };

      const onEnd = () => {
        if (settled) return;
        try {
          if (isCompressed) {
            const merged = Buffer.concat(encodedChunks);
            const decoded = decompressBuffer(limits.encoding, merged, limits.maxDecoded);
            if (decoded.byteLength > limits.maxDecoded) {
              fail(new EgressPolicyError(
                'byte-limit',
                `Decoded response exceeds limit (${decoded.byteLength} > ${limits.maxDecoded})`,
              ));
              return;
            }
            controller.enqueue(new Uint8Array(decoded));
          }
          settled = true;
          cleanup();
          controller.close();
        } catch (error) {
          fail(error);
        }
      };

      if (limits.signal.aborted) {
        onAbort();
        return;
      }
      limits.signal.addEventListener('abort', onAbort, { once: true });
      source.on('data', onData);
      source.on('end', onEnd);
      source.on('error', fail);
      resetIdle(fail);
    },
    cancel(reason?: unknown) {
      cancelBody();
      source.destroy(reason instanceof Error ? reason : new Error('Response body cancelled'));
    },
  });
}

function createFetchResponse(
  status: number,
  statusText: string,
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
): Response {
  let bodyUsed = false;
  const readAll = async (): Promise<Uint8Array> => {
    if (!body) return new Uint8Array();
    if (bodyUsed) throw new TypeError('Body has already been consumed');
    bodyUsed = true;
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
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
    return merged;
  };

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers,
    body,
    redirected: false,
    type: 'basic',
    url: '',
    get bodyUsed() {
      return bodyUsed;
    },
    async arrayBuffer() {
      const bytes = await readAll();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async bytes() {
      return await readAll();
    },
    async text() {
      return new TextDecoder().decode(await readAll());
    },
    async json() {
      const text = new TextDecoder().decode(await readAll());
      return JSON.parse(text) as unknown;
    },
    async blob() {
      const bytes = await readAll();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy]);
    },
    async formData(): Promise<FormData> {
      throw new Error('Response.formData is not supported by the Pivi scoped HTTP client');
    },
    clone(): Response {
      throw new Error('Response.clone is not supported by the Pivi scoped HTTP client');
    },
  } as unknown as Response;
}

async function resolveAndPin(
  url: URL,
  policy: ResolvedEgressPolicy,
  lookup: DnsLookupFn,
  grants: OriginGrantRegistry | undefined,
): Promise<{ pinned: string; approved: string[]; family: 4 | 6 }> {
  const hostname = stripBrackets(url.hostname);
  const first = isLiteralIpHostname(hostname)
    ? [hostname]
    : [...await lookup(hostname)];
  assertDestinationAllowed(url, first, policy, grants);

  const second = isLiteralIpHostname(hostname)
    ? [hostname]
    : [...await lookup(hostname)];
  const approvedSet = new Set(first.map((address) => address.toLowerCase()));
  const pinned = second.find((address) => approvedSet.has(address.toLowerCase()));
  if (!pinned) {
    throw new EgressPolicyError(
      'pin-mismatch',
      `DNS addresses changed before connect for ${redactUrl(url)}`,
    );
  }
  assertPinnedAddress(first, pinned, url);
  return {
    pinned,
    approved: first,
    family: pinned.includes(':') ? 6 : 4,
  };
}

function requestOnce(
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | undefined,
  policy: ResolvedEgressPolicy,
  lookup: DnsLookupFn,
  grants: OriginGrantRegistry | undefined,
  agent: ScopedHttpClientOptions['agent'],
  signal: AbortSignal,
): Promise<RawHttpResult> {
  return (async () => {
    const { pinned, family } = await resolveAndPin(url, policy, lookup, grants);
    applyScopedHttpDefaultHeaders(headers);

    const connectDeadline = createDeadlineSignal(policy.deadlines.connectMs, 'Connect');
    const firstByteDeadline = createDeadlineSignal(policy.deadlines.firstByteMs, 'First-byte');
    const combined = mergeAbortSignals([signal, connectDeadline.signal, firstByteDeadline.signal]);

    const transport = url.protocol === 'https:' ? https : http;
    const requestHeaders = headersToRecord(headers);
    // Preserve the original hostname in Host / SNI while connecting to the pinned address.
    requestHeaders.host = url.host;
    if (body) {
      requestHeaders['content-length'] = String(body.byteLength);
    }
    const resolvedAgent = typeof agent === 'function' ? agent(url) : agent;

    return await new Promise<RawHttpResult>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        connectDeadline.clear();
        firstByteDeadline.clear();
        combined.signal.removeEventListener('abort', onAbort);
        combined.dispose();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const onAbort = () => {
        req.destroy();
        fail(combined.signal.reason instanceof Error
          ? combined.signal.reason
          : new EgressPolicyError('aborted', 'Request aborted'));
      };

      const req = transport.request(
        {
          protocol: url.protocol,
          hostname: pinned,
          servername: url.protocol === 'https:' ? stripBrackets(url.hostname) : undefined,
          port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method,
          headers: requestHeaders,
          agent: resolvedAgent,
          family,
          lookup: (_host, _options, callback) => {
            callback(null, pinned, family);
          },
        },
        (res: http.IncomingMessage) => {
          if (settled) return;
          settled = true;
          connectDeadline.clear();
          firstByteDeadline.clear();
          combined.signal.removeEventListener('abort', onAbort);
          combined.dispose();

          const remote = res.socket?.remoteAddress?.replace(/^::ffff:/, '');
          if (remote) {
            try {
              assertPinnedAddress([pinned], remote, url);
            } catch (error) {
              res.destroy();
              reject(error instanceof Error ? error : new Error(String(error)));
              return;
            }
          }

          resolve({
            status: res.statusCode ?? 500,
            statusText: res.statusMessage ?? '',
            headers: headersFromIncoming(res),
            body: res,
            remoteAddress: remote,
          });
        },
      );

      req.on('error', (error: Error) => fail(error));
      req.on('timeout', () => {
        req.destroy();
        fail(new EgressPolicyError('deadline', `Connect deadline exceeded (${policy.deadlines.connectMs}ms)`));
      });
      req.setTimeout(policy.deadlines.connectMs);

      if (combined.signal.aborted) {
        onAbort();
        return;
      }
      combined.signal.addEventListener('abort', onAbort, { once: true });

      if (body) req.end(body);
      else req.end();
    });
  })();
}

function toResponse(
  raw: RawHttpResult,
  policy: ResolvedEgressPolicy,
  signal: AbortSignal,
  followBody: boolean,
  onBodyDone: () => void,
): Response {
  if (!followBody || !raw.body) {
    raw.body?.resume();
    onBodyDone();
    return createFetchResponse(raw.status, raw.statusText, raw.headers, null);
  }

  if (!contentTypeAllowed(raw.headers.get('content-type'), policy.allowedContentTypes)) {
    raw.body.destroy();
    throw new EgressPolicyError(
      'content-type',
      `Disallowed content type "${raw.headers.get('content-type') ?? ''}"`,
    );
  }

  const bodyStream = createLimitedBodyStream(raw.body, {
    maxEncoded: policy.byteLimits.maxEncodedResponseBytes,
    maxDecoded: policy.byteLimits.maxDecodedResponseBytes,
    encoding: raw.headers.get('content-encoding'),
    idleMs: policy.deadlines.idleMs,
    signal,
  }, onBodyDone);
  return createFetchResponse(raw.status, raw.statusText, raw.headers, bodyStream);
}

async function scopedFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: ScopedHttpClientOptions,
): Promise<Response> {
  const policy = resolveEgressPolicy(options.policy);
  const lookup = options.lookup ?? defaultLookup;
  const totalDeadline = createDeadlineSignal(policy.deadlines.totalMs, 'Total');
  let deadlineOwnedByBody = false;
  const merged = mergeAbortSignals([
    init?.signal ?? (input instanceof Request ? input.signal : undefined),
    policy.signal,
    totalDeadline.signal,
  ]);
  const signal = merged.signal;
  const finish = () => {
    totalDeadline.clear();
    merged.dispose();
  };

  try {
    const rawUrl = input instanceof Request ? input.url : input;
    let url = normalizeHttpUrl(typeof rawUrl === 'string' || rawUrl instanceof URL ? rawUrl : String(rawUrl));

    let method = (
      init?.method
      ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    let headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    let body = await readRequestBody(
      init?.body ?? (input instanceof Request ? input.body : undefined),
      policy.byteLimits.maxRequestBytes,
    );

    let redirectCount = 0;
    for (;;) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new EgressPolicyError('aborted', 'Request aborted');
      }

      const raw = await requestOnce(
        url,
        method,
        headers,
        body,
        policy,
        lookup,
        options.grants,
        options.agent,
        signal,
      );

      if (raw.status >= 300 && raw.status < 400) {
        const location = raw.headers.get('location');
        raw.body?.resume();
        if (!location) {
          return toResponse(raw, policy, signal, false, finish);
        }
        const nextUrl = prepareRedirect(url, location, redirectCount, policy);
        headers = filterRedirectHeaders(headers, url, nextUrl);
        if (
          method !== 'HEAD'
          && (raw.status === 301 || raw.status === 302 || raw.status === 303)
        ) {
          method = 'GET';
          body = undefined;
        }
        url = nextUrl;
        redirectCount += 1;
        continue;
      }

      const response = toResponse(raw, policy, signal, true, finish);
      deadlineOwnedByBody = response.body !== null;
      return response;
    }
  } catch (error) {
    if (error instanceof NetworkUrlError || error instanceof EgressPolicyError) {
      throw error;
    }
    throw error;
  } finally {
    if (!deadlineOwnedByBody) {
      finish();
    }
  }
}

export function createScopedFetch(options: ScopedHttpClientOptions): FetchCompatible {
  return (input, init) => scopedFetch(input, init, options);
}

export function createScopedHttpClient(options: ScopedHttpClientOptions): HttpClient {
  const fetchImpl = createScopedFetch(options);
  return {
    async fetch(request: HttpRequest): Promise<HttpResponse> {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: typeof request.body === 'string'
          ? request.body
          : request.body
            ? Buffer.from(request.body)
            : undefined,
      });
      const textBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        text: async () => textBody,
        json: async <T = unknown>() => JSON.parse(textBody) as T,
      };
    },
  };
}
