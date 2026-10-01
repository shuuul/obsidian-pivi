/**
 * Scoped Node http(s) client with egress policy, DNS pinning, redirects,
 * deadlines, streaming byte limits, and a Fetch-compatible Response surface.
 */

import {
  assertPinnedAddress,
  contentTypeAllowed,
  type DnsLookupFn,
  EgressPolicyError,
  type EgressPolicyOptions,
  filterRedirectHeaders,
  isLiteralIpHostname,
  normalizeHttpUrl,
  type OriginGrantRegistry,
  prepareRedirect,
  redactUrl,
  type ResolvedEgressPolicy,
  resolveEgressPolicy,
  selectAllowedResolvedAddresses,
} from '@pivi/agent/network';
import type { FetchCompatible, HttpClient, HttpRequest, HttpResponse } from '@pivi/agent/ports';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import type { Socket } from 'net';
import type { Readable } from 'stream';

import { createFetchResponse, createLimitedBodyStream } from './scopedHttpResponseBody';

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
  // 0 disables the timer so long-running provider streams can opt out of Total.
  if (ms <= 0) {
    return {
      signal: controller.signal,
      clear: () => undefined,
    };
  }
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
  const approved = selectAllowedResolvedAddresses(url, first, policy, grants);

  const second = isLiteralIpHostname(hostname)
    ? [hostname]
    : [...await lookup(hostname)];
  const approvedSet = new Set(approved.map((address) => address.toLowerCase()));
  const pinned = second.find((address) => approvedSet.has(address.toLowerCase()));
  if (!pinned) {
    throw new EgressPolicyError(
      'pin-mismatch',
      `DNS addresses changed before connect for ${redactUrl(url)}`,
    );
  }
  assertPinnedAddress(approved, pinned, url);
  return {
    pinned,
    approved,
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
      let phaseTimer: number | undefined;
      let phaseSocket: Socket | undefined;
      let phaseEvent: 'connect' | 'secureConnect' | undefined;
      let req: http.ClientRequest | undefined;

      const clearPhase = () => {
        if (phaseTimer !== undefined) {
          window.clearTimeout(phaseTimer);
          phaseTimer = undefined;
        }
        if (phaseSocket && phaseEvent) {
          phaseSocket.removeListener(phaseEvent, startFirstBytePhase);
        }
        phaseSocket = undefined;
        phaseEvent = undefined;
      };
      const cleanup = () => {
        clearPhase();
        signal.removeEventListener('abort', onAbort);
        req?.removeListener('socket', onSocket);
      };
      const fail = (error: unknown, destroyRequest = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (destroyRequest) req?.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const onAbort = () => {
        fail(signal.reason instanceof Error
          ? signal.reason
          : new EgressPolicyError('aborted', 'Request aborted'), true);
      };
      const armPhase = (label: 'Connect' | 'First-byte', ms: number) => {
        clearPhase();
        phaseTimer = window.setTimeout(() => {
          if (signal.aborted) {
            onAbort();
            return;
          }
          fail(new EgressPolicyError(
            'deadline',
            `${label} deadline exceeded (${ms}ms)`,
          ), true);
        }, ms);
      };
      function startFirstBytePhase(): void {
        if (settled) return;
        armPhase('First-byte', policy.deadlines.firstByteMs);
      }
      const onSocket = (socket: Socket) => {
        if (settled) return;
        if (req?.reusedSocket) {
          startFirstBytePhase();
          return;
        }
        if (url.protocol === 'https:') {
          phaseSocket = socket;
          phaseEvent = 'secureConnect';
          socket.once('secureConnect', startFirstBytePhase);
          // A queued request can receive an already-secure socket without Node
          // marking it as reused or replaying secureConnect.
          const secureConnecting = (socket as Socket & { secureConnecting?: boolean })
            .secureConnecting;
          if (!socket.connecting && secureConnecting === false) {
            startFirstBytePhase();
          }
          return;
        }
        if (!socket.connecting) {
          startFirstBytePhase();
          return;
        }
        phaseSocket = socket;
        phaseEvent = 'connect';
        socket.once('connect', startFirstBytePhase);
      };
      const onResponse = (res: http.IncomingMessage) => {
        if (settled) return;
        settled = true;
        cleanup();
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
      };

      armPhase('Connect', policy.deadlines.connectMs);
      try {
        req = transport.request(
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
          onResponse,
        );
      } catch (error) {
        fail(error);
        return;
      }

      req.on('error', (error: Error) => fail(error));
      req.on('socket', onSocket);

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

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

function throwIfRequestAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new EgressPolicyError('aborted', 'Request aborted');
  }
}

/** Resolves the first hop from fetch arguments; `init` fields win over a `Request` input. */
async function readInitialRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
  maxRequestBytes: number,
) {
  const rawUrl = input instanceof Request ? input.url : input;
  const url = normalizeHttpUrl(typeof rawUrl === 'string' || rawUrl instanceof URL ? rawUrl : String(rawUrl));

  const method = (
    init?.method
    ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const body = await readRequestBody(
    init?.body ?? (input instanceof Request ? input.body : undefined),
    maxRequestBytes,
  );
  return { url, method, headers, body };
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
    const request = await readInitialRequest(input, init, policy.byteLimits.maxRequestBytes);
    let { url, method, headers, body } = request;

    let redirectCount = 0;
    for (;;) {
      throwIfRequestAborted(signal);

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
