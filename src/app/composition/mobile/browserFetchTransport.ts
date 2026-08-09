export interface BrowserFetchTransportOptions {
  readonly fetch: typeof window.fetch;
}

type BrowserFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function redactedTarget(input: string | URL | Request): string {
  try {
    const raw = input instanceof Request ? input.url : input.toString();
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<provider endpoint>';
  }
}

/**
 * Use the WebView's native fetch unchanged so its body remains a real incremental
 * ReadableStream and AbortSignal ownership reaches the underlying request.
 */
export function createBrowserFetchTransport(
  options: BrowserFetchTransportOptions,
): BrowserFetch {
  return async (input, init) => {
    try {
      return await options.fetch(input, init);
    } catch {
      if (init?.signal?.aborted) {
        throw new DOMException('Provider request was aborted.', 'AbortError');
      }
      // Native errors may contain request headers or WebView diagnostics. Never retain them.
      throw new Error(`Provider request failed for ${redactedTarget(input)}`);
    }
  };
}
