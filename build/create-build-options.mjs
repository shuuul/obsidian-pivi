import path from 'path';
import { fileURLToPath } from 'url';
import { external } from './externals.mjs';
import { dedupePiCodingAgentNested } from './plugins/dedupe-pi-dependencies.mjs';
import { shimPiCodingAgentConfig } from './plugins/shim-pi-coding-agent-config.mjs';
import { shimPiAiCompat, shimPiAiEnvApiKeys } from './plugins/shim-pi-ai.mjs';
import { shimSignalExit } from './plugins/shim-signal-exit.mjs';
import { shimDebug } from './plugins/shim-debug.mjs';

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
      shimPiCodingAgentConfig,
      shimPiAiCompat,
      shimPiAiEnvApiKeys,
      shimSignalExit,
      shimDebug,
    ],
    platform: 'node',
    external,
    format: 'cjs',
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
