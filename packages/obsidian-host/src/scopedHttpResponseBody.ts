/**
 * Response-body handling for the scoped HTTP client: streaming byte limits,
 * idle deadlines, decompression, and the Fetch-compatible Response surface.
 */

import { EgressPolicyError } from '@pivi/agent/network';
import type { Readable } from 'stream';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'zlib';

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

export function createLimitedBodyStream(
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
    idleTimer = undefined;
    // 0 disables idle so sparse SSE/token streams are not killed between chunks.
    if (limits.idleMs <= 0) return;
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
        // Node surfaces mid-stream socket death as message "aborted" (ECONNRESET).
        // Duck-type the message: Node's Error can fail instanceof across realms.
        let message: string | undefined;
        if (error && typeof error === 'object' && 'message' in error) {
          const rawMessage = error.message;
          if (typeof rawMessage === 'string') message = rawMessage;
        }
        if (message === 'aborted') {
          const cause = error instanceof Error
            ? error
            : Object.assign(new Error(message), error);
          controller.error(new Error('Connection closed prematurely', { cause }));
          return;
        }
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

export function createFetchResponse(
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
