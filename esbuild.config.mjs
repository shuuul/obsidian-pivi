import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
// Load .env.local if it exists
if (existsSync('.env.local')) {
  const envContent = readFileSync('.env.local', 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=["']?(.+?)["']?$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const prod = process.argv[2] === 'production';
const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** pi-coding-agent config.js uses import.meta.url; replace with Obsidian-safe shim. */
const piCodingAgentConfigShim = path.join(rootDir, 'src/pi/shims/piCodingAgentConfig.ts');

const piCodingAgentConfigPath = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/dist/config.js',
);

const shimPiCodingAgentConfig = {
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

const piCodingAgentNestedModules = path.join(
  rootDir,
  'node_modules/@earendil-works/pi-coding-agent/node_modules',
);
const rootNodeModules = path.join(rootDir, 'node_modules');

/**
 * pi-coding-agent ships npm-shrinkwrap with nested deps; resolve from project root
 * so esbuild does not bundle duplicate copies of pi-ai, zod, provider SDKs, etc.
 */
const dedupePiCodingAgentNested = {
  name: 'dedupe-pi-coding-agent-nested',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (!args.importer?.startsWith(`${piCodingAgentNestedModules}${path.sep}`)) {
        return;
      }
      // Hoist package imports only; relative paths must stay in the nested package.
      if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
        return;
      }
      return build.resolve(args.path, {
        resolveDir: rootNodeModules,
        kind: args.kind,
      });
    });
  },
};

// Obsidian plugin folder path (set via OBSIDIAN_VAULT env var or .env.local)
const OBSIDIAN_VAULT = process.env.OBSIDIAN_VAULT;
const OBSIDIAN_PLUGIN_PATH = OBSIDIAN_VAULT && existsSync(OBSIDIAN_VAULT)
  ? path.join(OBSIDIAN_VAULT, '.obsidian', 'plugins', 'obsius2')
  : null;

/** Obsidian community plugins ship only these artifacts (plus runtime data.json). */
const OBSIDIAN_PLUGIN_DEPLOY_FILES = new Set(['main.js', 'manifest.json', 'styles.css']);

/**
 * Dynamic `import("node:…")` is resolved as a URL fetch in Electron's renderer and fails.
 * Rewrite to `require()` wrapped in Promise for CJS bundles.
 */
function rewriteDynamicNodeImports(bundlePath) {
  const source = readFileSync(bundlePath, 'utf-8');
  const rewritten = source.replace(
    /import\((['"])node:([^'"]+)\1\)/g,
    'Promise.resolve(require($1node:$2$1))',
  );
  if (rewritten !== source) {
    writeFileSync(bundlePath, rewritten);
    console.log(`Rewrote dynamic node: imports in ${path.basename(bundlePath)}`);
  }
}

function pruneStaleObsidianPluginArtifacts(pluginPath) {
  const keep = new Set([...OBSIDIAN_PLUGIN_DEPLOY_FILES, 'data.json']);
  for (const name of readdirSync(pluginPath)) {
    if (keep.has(name)) {
      continue;
    }
    rmSync(path.join(pluginPath, name), { recursive: true, force: true });
    console.log(`Removed stale Obsidian plugin artifact: ${name}`);
  }
}

const copyToObsidian = {
  name: 'copy-to-obsidian',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      rewriteDynamicNodeImports('main.js');

      if (!OBSIDIAN_PLUGIN_PATH) return;

      if (!existsSync(OBSIDIAN_PLUGIN_PATH)) {
        mkdirSync(OBSIDIAN_PLUGIN_PATH, { recursive: true });
      }

      pruneStaleObsidianPluginArtifacts(OBSIDIAN_PLUGIN_PATH);

      for (const file of OBSIDIAN_PLUGIN_DEPLOY_FILES) {
        if (existsSync(file)) {
          copyFileSync(file, path.join(OBSIDIAN_PLUGIN_PATH, file));
          console.log(`Copied ${file} to Obsidian plugin folder`);
        }
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [dedupePiCodingAgentNested, shimPiCodingAgentConfig, copyToObsidian],
  platform: 'node',
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  minify: prod,
  treeShaking: true,
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
