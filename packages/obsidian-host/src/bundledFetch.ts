/**
 * Process-local fetch binding used by the production bundle inject shim.
 * Composition installs a scoped client; free `fetch` identifiers in upstream SDKs
 * resolve here without assigning `window.fetch`.
 */

import type { FetchCompatible } from '@pivi/pivi-agent-core/ports';

let installed: FetchCompatible | null = null;

export function installBundledFetch(fetchImpl: FetchCompatible): void {
  installed = fetchImpl;
}

export function getBundledFetch(): FetchCompatible {
  if (!installed) {
    throw new Error('Pivi bundled fetch is not installed. Composition must call installBundledFetch().');
  }
  return installed;
}

/** Injected global `fetch` replacement for esbuild `inject` (not window.fetch). */
export function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return getBundledFetch()(input, init);
}
