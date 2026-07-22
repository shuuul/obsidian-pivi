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
import { releaseArtifactBanner } from './release-artifact-version.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');

/**
 * Returns the common production/development build configuration without deployment side effects.
 * Callers may append output lifecycle plugins such as the Obsidian deployer.
 */
export function createBuildOptions({ production, metafile = false, write = true }) {
  return {
    entryPoints: [path.join(projectRoot, 'src/main.ts')],
    bundle: true,
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
