import { version } from 'react';
import { createRoot } from 'react-dom/client';

/** Startup guard: confirm the bundled React production runtime is present. */
export function assertBundledReactRuntime(): void {
  if (!version || typeof createRoot !== 'function') {
    throw new Error('Bundled React UI runtime is unavailable');
  }
}
