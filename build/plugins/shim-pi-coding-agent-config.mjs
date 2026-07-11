import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const piCodingAgentConfigShim = path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi/shims/piCodingAgentConfig.ts',
);
const piCodingAgentConfigPath = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/dist/config.js',
);

/** pi-coding-agent config.js uses import.meta.url; replace with Obsidian-safe shim. */
export const shimPiCodingAgentConfig = {
  name: 'shim-pi-coding-agent-config',
  setup(build) {
    build.onResolve({ filter: /config\.js$/ }, (args) => {
      const resolved = path.normalize(path.join(args.resolveDir, args.path));
      if (resolved !== path.normalize(piCodingAgentConfigPath)) {
        return;
      }
      return { path: piCodingAgentConfigShim };
    });
  },
};
