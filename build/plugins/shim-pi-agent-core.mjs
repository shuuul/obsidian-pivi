import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeImporters = new Set([
  'piChatRuntime.ts',
  'piAuxQueryRunner.ts',
].map((file) => path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi',
  file,
)));
const agentRuntime = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-agent-core/dist/agent.js',
);

/**
 * The upstream root barrel eagerly exports its Node-oriented harness and YAML
 * loaders. PiChatRuntime only consumes Agent, so bundle that browser-safe leaf.
 */
export const shimPiAgentCoreRuntime = {
  name: 'shim-pi-agent-core-runtime',
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-agent-core$/ }, (args) => {
      if (!runtimeImporters.has(path.normalize(args.importer))) return;
      return { path: agentRuntime };
    });
  },
};
