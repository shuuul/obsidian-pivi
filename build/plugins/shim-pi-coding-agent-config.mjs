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
const piCodingAgentSessionEntrypoint = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js',
);
const piCodingAgentCompactionEntrypoint = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js',
);
const piCodingAgentMessagesEntrypoint = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js',
);
const piCodingAgentFacadeNamespace = 'pivi-pi-coding-agent-public-facade';
const piCodingAgentContextFacadeNamespace = 'pivi-pi-coding-agent-context-facade';
const piContextCompactionImporter = path.join(
  rootDir,
  'packages/pivi-agent-core/src/engine/pi/session/piContextCompaction.ts',
);
const piAgentCompactionEntrypoint = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-agent-core/dist/harness/compaction/compaction.js',
);
const piAgentMessagesEntrypoint = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-agent-core/dist/harness/messages.js',
);

/**
 * Pivi consumes only public session, compaction, and message exports. The
 * upstream root entrypoint statically re-exports its CLI/TUI, which is neither
 * needed nor Obsidian-safe, so the bundle resolves that root to a narrow facade.
 */
export const shimPiCodingAgentSessionEntrypoint = {
  name: 'shim-pi-coding-agent-session-entrypoint',
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-coding-agent$/ }, (args) => (
      path.normalize(args.importer) === piContextCompactionImporter
        ? {
            path: 'pi-coding-agent-context-facade',
            namespace: piCodingAgentContextFacadeNamespace,
          }
        : {
            path: 'pi-coding-agent-public-facade',
            namespace: piCodingAgentFacadeNamespace,
          }
    ));
    build.onLoad(
      {
        filter: /.*/,
        namespace: piCodingAgentFacadeNamespace,
      },
      () => ({
        contents: [
          `export * from ${JSON.stringify(piCodingAgentSessionEntrypoint)};`,
          `export { estimateTokens, findCutPoint } from ${JSON.stringify(piCodingAgentCompactionEntrypoint)};`,
          `export { convertToLlm } from ${JSON.stringify(piCodingAgentMessagesEntrypoint)};`,
        ].join('\n'),
        loader: 'js',
        resolveDir: rootDir,
      }),
    );
    build.onLoad(
      {
        filter: /.*/,
        namespace: piCodingAgentContextFacadeNamespace,
      },
      () => ({
        contents: [
          `export { estimateTokens, findCutPoint } from ${JSON.stringify(piAgentCompactionEntrypoint)};`,
          `export { convertToLlm } from ${JSON.stringify(piAgentMessagesEntrypoint)};`,
        ].join('\n'),
        loader: 'js',
        resolveDir: rootDir,
      }),
    );
  },
};

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
