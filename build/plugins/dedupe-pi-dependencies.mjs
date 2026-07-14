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
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (!args.importer?.startsWith(`${piCodingAgentNestedModules}${path.sep}`)) {
        return;
      }
      // Relative paths and package-import aliases must resolve in their owning
      // nested package so package.json imports such as Chalk's #ansi-styles work.
      if (args.path.startsWith('.') || args.path.startsWith('#') || path.isAbsolute(args.path)) {
        return;
      }
      const rootResolution = await build.resolve(args.path, {
        resolveDir: rootNodeModules,
        kind: args.kind,
      });
      // Only dedupe dependencies that actually exist at the project root. Pi's
      // shrinkwrap also contains unique packages that must stay nested.
      return rootResolution.errors.length === 0 ? rootResolution : undefined;
    });
  },
};
