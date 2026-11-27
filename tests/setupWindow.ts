import { readFileSync } from 'node:fs';
import path from 'node:path';

type TestWindow = typeof window & {
  cancelAnimationFrame?: (handle: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
) as { version?: string };
const releaseMetadata = globalThis as {
  __PIVI_RELEASE_VERSION__?: string;
};
releaseMetadata.__PIVI_RELEASE_VERSION__ = packageJson.version;

const testWindow = (globalThis.window ?? globalThis) as TestWindow;

export function formatUnexpectedConsole(method: 'warn' | 'error', values: unknown[]): string {
  const rendered = values.map((value) => {
    if (value instanceof Error) return value.stack ?? value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ');
  return `Unexpected console.${method}: ${rendered}`;
}

let unexpectedConsole: string[] = [];

beforeEach(() => {
  unexpectedConsole = [];
  jest.spyOn(console, 'warn').mockImplementation((...values: unknown[]) => {
    unexpectedConsole.push(formatUnexpectedConsole('warn', values));
  });
  jest.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    unexpectedConsole.push(formatUnexpectedConsole('error', values));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (unexpectedConsole.length > 0) {
    throw new Error(unexpectedConsole.join('\n\n'));
  }
});

if (!globalThis.window) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
    writable: true,
  });
}

/** Jest uses testEnvironment: node — stub browser Image used by provider logo preload. */
if (typeof testWindow.Image === 'undefined') {
  Object.defineProperty(testWindow, 'Image', {
    configurable: true,
    writable: true,
    value: class {
      src = '';
    },
  });
}

if (!testWindow.requestAnimationFrame) {
  testWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    Number(globalThis.setTimeout(() => callback(Date.now()), 0))
  );
}

if (!testWindow.cancelAnimationFrame) {
  testWindow.cancelAnimationFrame = (handle: number): void => {
    globalThis.clearTimeout(handle);
  };
}

// Obsidian augments Node.prototype.instanceOf for cross-window DOM checks.
// This shim covers the main jsdom realm only; iframe fixtures install their own.
// Within this realm, same-realm instanceof implements the same contract.
const nodePrototype = globalThis.Node?.prototype as (Node & { instanceOf?: unknown }) | undefined;
if (nodePrototype && typeof nodePrototype.instanceOf !== 'function') {
  Object.defineProperty(nodePrototype, 'instanceOf', {
    configurable: true,
    writable: true,
    value(this: Node, type: new () => unknown): boolean {
      return this instanceof type;
    },
  });
}
