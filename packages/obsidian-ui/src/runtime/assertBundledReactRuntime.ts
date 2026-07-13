import { version } from 'react';
import { createRoot } from 'react-dom/client';

/** Phase-one bundle assertion; product roots replace this call once mount APIs are wired. */
export function assertBundledReactRuntime(): void {
  if (!version || typeof createRoot !== 'function') {
    throw new Error('Bundled React UI runtime is unavailable');
  }
}
