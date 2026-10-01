import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The bundle is built for `platform: 'node'`, so these packages would resolve to Node
 * entrypoints that carry code Pivi never runs in Obsidian's renderer.
 *
 * - `@google/genai`: the Node build statically imports google-auth-library, ws, and their
 *   HTTP stack for Vertex/ADC auth and Live sockets. Pivi ships only the API-key Google
 *   provider, which the web build serves through the same free `fetch` identifier.
 * - `yaml`: pi-agent-core's harness imports it for skills and prompt templates Pivi does
 *   not use. The Node entry is CommonJS and stays whole; the ESM build tree-shakes away.
 */
const browserBuilds = new Map([
  ['@google/genai', path.join(rootDir, 'node_modules/@google/genai/dist/web/index.mjs')],
  ['yaml', path.join(rootDir, 'node_modules/yaml/browser/index.js')],
]);

export const preferBrowserBuilds = {
  name: 'prefer-browser-builds',
  setup(build) {
    build.onResolve({ filter: /^(?:@google\/genai|yaml)$/ }, (args) => ({
      path: browserBuilds.get(args.path),
    }));
  },
};
