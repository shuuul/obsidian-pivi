import { buildSync } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
import { external } from './externals.mjs';
import { assertCommunityAudit } from './plugins/assert-community-audit.mjs';
import { stripReactHoistableScripts } from './plugins/strip-react-hoistable-scripts.mjs';
import { dedupePiCodingAgentNested } from './plugins/dedupe-pi-dependencies.mjs';
import {
  shimPiCodingAgentConfig,
  shimPiCodingAgentSessionEntrypoint,
} from './plugins/shim-pi-coding-agent-config.mjs';
import { shimPiAiCompat, shimPiAiEnvApiKeys } from './plugins/shim-pi-ai.mjs';
import { shimSignalExit } from './plugins/shim-signal-exit.mjs';
import { shimDebug } from './plugins/shim-debug.mjs';
import { shimMcpValidation } from './plugins/shim-mcp-validation.mjs';
import { releaseArtifactBanner, releaseArtifactVersion } from './release-artifact-version.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');

function buildEmbeddedSkillsCli() {
  const result = buildSync({
    entryPoints: [path.join(projectRoot, 'node_modules/skills/bin/cli.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
      js: "import { createRequire as __piviCreateRequire } from 'node:module'; const require = __piviCreateRequire(import.meta.url);",
    },
    minify: true,
    write: false,
  });
  const source = result.outputFiles?.[0]?.contents;
  if (!source) {
    throw new Error('Failed to bundle the pinned skills CLI dependency.');
  }
  return Buffer.from(source).toString('base64');
}

const embeddedSkillsCliBase64 = buildEmbeddedSkillsCli();

/**
 * Returns the common production/development build configuration without deployment side effects.
 * Callers may append output lifecycle plugins such as the Obsidian deployer.
 */
export function createBuildOptions({ production, metafile = false, write = true }) {
  return {
    entryPoints: [path.join(projectRoot, 'src/main.ts')],
    bundle: true,
    // Replace free `fetch` identifiers in upstream SDKs with the scoped Pivi client
    // without assigning `window.fetch`.
    inject: [path.join(projectRoot, 'packages/obsidian-host/src/bundledFetch.ts')],
    plugins: [
      dedupePiCodingAgentNested,
      shimPiCodingAgentSessionEntrypoint,
      shimPiCodingAgentConfig,
      shimPiAiCompat,
      shimPiAiEnvApiKeys,
      shimSignalExit,
      shimDebug,
      shimMcpValidation,
      stripReactHoistableScripts,
      ...(production ? [assertCommunityAudit] : []),
    ],
    platform: 'node',
    external,
    format: 'cjs',
    banner: {
      js: releaseArtifactBanner,
    },
    charset: 'utf8',
    target: 'es2022',
    define: {
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
      __PIVI_RELEASE_VERSION__: JSON.stringify(releaseArtifactVersion),
      __PIVI_EMBEDDED_SKILLS_CLI_BASE64__: JSON.stringify(embeddedSkillsCliBase64),
    },
    jsx: 'automatic',
    jsxImportSource: 'react',
    loader: {
      '.svg': 'text',
    },
    logLevel: 'info',
    sourcemap: production ? false : 'inline',
    minify: production,
    treeShaking: true,
    outfile: path.join(projectRoot, 'main.js'),
    metafile,
    write,
  };
}
