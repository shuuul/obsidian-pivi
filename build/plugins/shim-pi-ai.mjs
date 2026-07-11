import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const piAiEnvApiKeysShim = path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi/shims/piAiEnvApiKeys.ts',
);
const piAiCompatShim = path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi/shims/piAiCompat.ts',
);

/** pi-ai compat pulls every upstream provider; Pivi only needs its supported provider set. */
export const shimPiAiCompat = {
  name: 'shim-pi-ai-compat',
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-ai\/compat$/ }, () => ({ path: piAiCompatShim }));
  },
};

/** pi-ai env-api-keys.js uses dynamic import("node:" + "fs"); replace with sync require shim. */
export const shimPiAiEnvApiKeys = {
  name: 'shim-pi-ai-env-api-keys',
  setup(build) {
    build.onResolve({ filter: /env-api-keys\.js$/ }, (args) => {
      const resolved = path.normalize(path.join(args.resolveDir, args.path));
      if (!resolved.endsWith(`${path.sep}pi-ai${path.sep}dist${path.sep}env-api-keys.js`)) {
        return;
      }
      return { path: piAiEnvApiKeysShim };
    });
  },
};
