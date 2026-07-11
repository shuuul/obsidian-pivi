import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const signalExitShim = path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi/shims/signalExit.cjs',
);

/** proper-lockfile calls require('signal-exit') as a function; avoid ESM interop object wrapper. */
export const shimSignalExit = {
  name: 'shim-signal-exit',
  setup(build) {
    build.onResolve({ filter: /^signal-exit$/ }, () => ({ path: signalExitShim }));
  },
};
