import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const piCodingAgentConfigShim = path.join(
  rootDir,
  'packages/engine-pi/src/shims/piCodingAgentConfig.ts',
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
const piCodingAgentFacadeId = '\0pi-coding-agent-public-facade';

/**
 * Pivi consumes only public session, compaction, and message exports. The
 * upstream root entrypoint statically re-exports its CLI/TUI, which is neither
 * needed nor Obsidian-safe, so the bundle resolves that root to a narrow facade.
 */
export const shimPiCodingAgentSessionEntrypoint = {
  name: 'shim-pi-coding-agent-session-entrypoint',
  resolveId: {
    filter: { id: /^@earendil-works\/pi-coding-agent$/ },
    handler: () => piCodingAgentFacadeId,
  },
  load(id) {
    if (id !== piCodingAgentFacadeId) return;
    return [
      `export * from ${JSON.stringify(piCodingAgentSessionEntrypoint)};`,
      `export { estimateTokens, findCutPoint } from ${JSON.stringify(piCodingAgentCompactionEntrypoint)};`,
      `export { convertToLlm } from ${JSON.stringify(piCodingAgentMessagesEntrypoint)};`,
    ].join('\n');
  },
};

/** pi-coding-agent config.js uses import.meta.url; replace with Obsidian-safe shim. */
export const shimPiCodingAgentConfig = {
  name: 'shim-pi-coding-agent-config',
  resolveId: {
    filter: { id: /config\.js$/ },
    handler(id, importer) {
      if (!importer) return;
      const resolved = path.resolve(path.dirname(importer), id);
      if (resolved === piCodingAgentConfigPath) return piCodingAgentConfigShim;
    },
  },
};
