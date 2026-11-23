import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import { external } from './externals.mjs';
import { assertCommunityAudit } from './plugins/assert-community-audit.mjs';
import { stripReactHoistableScripts } from './plugins/strip-react-hoistable-scripts.mjs';
import {
  shimPiCodingAgentConfig,
  shimPiCodingAgentSessionEntrypoint,
} from './plugins/shim-pi-coding-agent-config.mjs';
import { shimPiAiCompat, shimPiAiEnvApiKeys } from './plugins/shim-pi-ai.mjs';
import { shimSignalExit } from './plugins/shim-signal-exit.mjs';
import { shimDebug } from './plugins/shim-debug.mjs';
import { preferBrowserBuilds } from './plugins/prefer-browser-builds.mjs';
import { rewriteDynamicNodeImports } from './postprocess/rewrite-node-imports.mjs';
import { releaseArtifactBanner, releaseArtifactVersion } from './release-artifact-version.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function buildEmbeddedSkillsCli() {
  const bundle = await rolldown({
    cwd: projectRoot,
    input: 'node_modules/skills/bin/cli.mjs',
    platform: 'node',
    transform: { target: 'node22' },
  });
  try {
    const { output } = await bundle.generate({ format: 'esm', codeSplitting: false, minify: true });
    if (output.length !== 1 || output[0].type !== 'chunk') {
      throw new Error('Expected a single embedded Skills CLI bundle.');
    }
    const compressed = gzipSync(output[0].code, { level: 9 });
    // Keep the gzip header platform-independent for equivalent builds.
    compressed[9] = 255;
    return compressed;
  } finally {
    await bundle.close();
  }
}

export async function createBuildOptions({ production }) {
  const skillsCli = await buildEmbeddedSkillsCli();
  return {
    skillsCliGzipBytes: skillsCli.byteLength,
    input: {
      cwd: projectRoot,
      input: 'src/main.ts',
      plugins: [
        shimPiCodingAgentSessionEntrypoint,
        shimPiCodingAgentConfig,
        shimPiAiCompat,
        shimPiAiEnvApiKeys,
        shimSignalExit,
        shimDebug,
        preferBrowserBuilds,
        stripReactHoistableScripts,
        ...(production ? [assertCommunityAudit] : []),
        {
          name: 'rewrite-node-imports',
          renderChunk(code, chunk) {
            return rewriteDynamicNodeImports(code, chunk.fileName);
          },
        },
      ],
      platform: 'node',
      external,
      moduleTypes: { '.svg': 'text' },
      transform: {
        target: 'es2022',
        // Route free fetch calls through the scoped client without changing window.fetch.
        inject: {
          fetch: [path.join(projectRoot, 'packages/obsidian-host/src/bundledFetch.ts'), 'fetch'],
        },
        define: {
          'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
          __PIVI_RELEASE_VERSION__: JSON.stringify(releaseArtifactVersion),
          __PIVI_EMBEDDED_SKILLS_CLI_GZIP_BASE64__: JSON.stringify(skillsCli.toString('base64')),
        },
        jsx: { runtime: 'automatic', importSource: 'react' },
      },
    },
    output: {
      file: path.join(projectRoot, 'main.js'),
      format: 'cjs',
      codeSplitting: false,
      banner: releaseArtifactBanner,
      sourcemap: production ? false : 'inline',
      minify: production,
    },
  };
}
