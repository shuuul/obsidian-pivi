import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const piCodingAgentNestedModules = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/node_modules',
);
const rootNodeModules = path.join(rootDir, 'node_modules');

/**
 * pi-coding-agent ships npm-shrinkwrap with nested deps; resolve from project root
 * so esbuild does not bundle duplicate copies of pi-ai, zod, provider SDKs, etc.
 */
export const dedupePiCodingAgentNested = {
  name: 'dedupe-pi-coding-agent-nested',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer?.startsWith(`${piCodingAgentNestedModules}${path.sep}`)) {
        return;
      }
      // Hoist package imports only; relative paths must stay in the nested package.
      if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
        return;
      }
      return build.resolve(args.path, {
        resolveDir: rootNodeModules,
        kind: args.kind,
      });
    });
  },
};
