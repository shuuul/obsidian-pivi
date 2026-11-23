import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const piAiEnvApiKeysShim = path.join(
  rootDir,
  'packages/engine-pi/src/shims/piAiEnvApiKeys.ts',
);
const piAiCompatShim = path.join(
  rootDir,
  'packages/engine-pi/src/shims/piAiCompat.ts',
);

/** pi-ai compat pulls every upstream provider; Pivi only needs its supported provider set. */
export const shimPiAiCompat = {
  name: 'shim-pi-ai-compat',
  resolveId: { filter: { id: /^@earendil-works\/pi-ai\/compat$/ }, handler: () => piAiCompatShim },
};

/** pi-ai env-api-keys.js uses dynamic import("node:" + "fs"); replace with sync require shim. */
export const shimPiAiEnvApiKeys = {
  name: 'shim-pi-ai-env-api-keys',
  resolveId: {
    filter: { id: /env-api-keys\.js$/ },
    handler(id, importer) {
      if (!importer) return;
      const resolved = path.resolve(path.dirname(importer), id);
      if (resolved.endsWith(`${path.sep}pi-ai${path.sep}dist${path.sep}env-api-keys.js`)) {
        return piAiEnvApiKeysShim;
      }
    },
  },
};
