import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const debugShim = path.join(rootDir, 'packages/obsidian-host/src/shims/debug.ts');

/** The debug browser build persists namespaces in localStorage; Pivi does not use dependency debug logs. */
export const shimDebug = {
  name: 'shim-debug',
  setup(build) {
    build.onResolve({ filter: /^debug$/ }, () => ({ path: debugShim }));
  },
};
