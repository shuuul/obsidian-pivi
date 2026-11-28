import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The bundle is built for `platform: 'node'`, so these packages would resolve to Node
 * entrypoints that carry code Pivi never runs in Obsidian's renderer.
 *
 * - `@google/genai`: the Node build statically imports google-auth-library, ws, and their
 *   HTTP stack for Vertex/ADC auth and Live sockets. Pivi ships only the API-key Google
 *   provider, which the web build serves through Pi's injected fetch.
 * - `yaml`: pi-coding-agent's frontmatter parser imports it, but that module sits outside
 *   Pivi's narrow facade. The Node entry is CommonJS and stays whole; the ESM build
 *   tree-shakes away if a future facade path reaches it.
 */
const browserBuilds = new Map([
  ['@google/genai', path.join(rootDir, 'node_modules/@google/genai/dist/web/index.mjs')],
  ['yaml', path.join(rootDir, 'node_modules/yaml/browser/index.js')],
]);

export const preferBrowserBuilds = {
  name: 'prefer-browser-builds',
  resolveId: { filter: { id: /^(?:@google\/genai|yaml)$/ }, handler: (id) => browserBuilds.get(id) },
};
