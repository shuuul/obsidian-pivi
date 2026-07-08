import esbuild from 'esbuild';
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
const piCodingAgentConfigShim = path.join(rootDir, 'packages/pivi-agent-core/src/engine/pi/shims/piCodingAgentConfig.ts');

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

/** pi-ai env-api-keys.js uses dynamic import("node:" + "fs"); replace with sync require shim. */
const piAiEnvApiKeysShim = path.join(rootDir, 'packages/pivi-agent-core/src/engine/pi/shims/piAiEnvApiKeys.ts');

/** pi-ai compat pulls every upstream provider; Pivi only needs its supported provider set. */
const piAiCompatShim = path.join(rootDir, 'packages/pivi-agent-core/src/engine/pi/shims/piAiCompat.ts');

const shimPiAiCompat = {
  name: 'shim-pi-ai-compat',
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-ai\/compat$/ }, () => ({ path: piAiCompatShim }));
  },
};

const shimPiAiEnvApiKeys = {
  name: 'shim-pi-ai-env-api-keys',
  setup(build) {
    build.onResolve({ filter: /env-api-keys\.js$/ }, (args) => {
      const resolved = path.normalize(path.join(args.resolveDir, args.path));
      if (!resolved.endsWith(`${path.sep}pi-ai${path.sep}dist${path.sep}env-api-keys.js`)) {
        return;
      }
      return { path: piAiEnvApiKeysShim };
    });
  },
};

/** proper-lockfile calls require('signal-exit') as a function; avoid ESM interop object wrapper. */
const signalExitShim = path.join(rootDir, 'packages/pivi-agent-core/src/engine/pi/shims/signalExit.cjs');

/** The debug browser build persists namespaces in localStorage; Pivi does not use dependency debug logs. */
const debugShim = path.join(rootDir, 'packages/obsidian-host/src/shims/debug.ts');

const shimSignalExit = {
  name: 'shim-signal-exit',
  setup(build) {
    build.onResolve({ filter: /^signal-exit$/ }, () => ({ path: signalExitShim }));
  },
};

const shimDebug = {
  name: 'shim-debug',
  setup(build) {
    build.onResolve({ filter: /^debug$/ }, () => ({ path: debugShim }));
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
  ? path.join(OBSIDIAN_VAULT, '.obsidian', 'plugins', 'pivi')
  : null;

/** Obsidian community plugins ship only these artifacts (plus runtime data.json). */
const OBSIDIAN_PLUGIN_DEPLOY_FILES = new Set(['main.js', 'manifest.json', 'styles.css']);

/**
 * Dynamic `import("node:…")` is resolved as a URL fetch in Electron's renderer and fails.
 * Rewrite to `require()` wrapped in Promise for CJS bundles.
 */
function rewriteDynamicNodeImports(bundlePath) {
  let source = readFileSync(bundlePath, 'utf-8');
  let changed = false;

  const literalNodeImport = source.replace(
    /import\((['"])node:([^'"]+)\1\)/g,
    'Promise.resolve(require($1$2$1))',
  );
  if (literalNodeImport !== source) {
    source = literalNodeImport;
    changed = true;
  }

  const nodeSchemeRequire = source.replace(
    /require\((['"])node:([^'"]+)\1\)/g,
    'require($1$2$1)',
  );
  if (nodeSchemeRequire !== source) {
    source = nodeSchemeRequire;
    changed = true;
  }

  const cryptoImport = source.replace(
    /import\((['"])crypto\1\)/g,
    'Promise.resolve(require($1crypto$1))',
  );
  if (cryptoImport !== source) {
    source = cryptoImport;
    changed = true;
  }

  // pi-ai env-api-keys lazy loader (survives if shim missed a duplicate bundle)
  const lazyFsOsPath = source.replace(
    /(\w+)=e=>import\((\w+)\(e\)\),(\w+)="node:fs",(\w+)="node:os",(\w+)="node:path";typeof process!="undefined"&&\([^)]+\)&&\(\1\(\3\)\.then\(e=>\{(\w+)=e\.existsSync\}\),\1\(\4\)\.then\(e=>\{(\w+)=e\.homedir\}\),\1\(\5\)\.then\(e=>\{(\w+)=e\.join\}\)\)/g,
    'typeof process!="undefined"&&($6=require("fs").existsSync,$7=require("os").homedir,$8=require("path").join)',
  );
  if (lazyFsOsPath !== source) {
    source = lazyFsOsPath;
    changed = true;
  }

  // pi-ai model auth helpers use a generic dynamic import loader for node builtins.
  const genericNodeBuiltinLoaders = source
    .replace(/(\w+)\("node:fs\/promises"\)/g, 'Promise.resolve(require("fs/promises"))')
    .replace(/(\w+)\("node:os"\)/g, 'Promise.resolve(require("os"))');
  if (genericNodeBuiltinLoaders !== source) {
    source = genericNodeBuiltinLoaders;
    changed = true;
  }

  // pi-ai openai-codex-responses lazy node:os loader (nested parens in process guard)
  const lazyOsOnly = source.replace(
    /(\w+)=\w+=>import\((\w+)\(\w+\)\),(\w+)="node:os";typeof process!="undefined"&&.*?&&\1\(\3\)\.then\(\w+=>\{(\w+)=\w+\}\)/g,
    'typeof process!="undefined"&&($4=require("os"))',
  );
  if (lazyOsOnly !== source) {
    source = lazyOsOnly;
    changed = true;
  }

  if (changed) {
    writeFileSync(bundlePath, source);
    console.log(`Rewrote dynamic node: imports in ${path.basename(bundlePath)}`);
  }

  if (/import\([^)]*node:/.test(source) || /=>import\([^)]*\),\w+="node:/.test(source) || /require\((['"])node:/.test(source)) {
    throw new Error('Build output still contains node: imports/requires. Update rewriteDynamicNodeImports().');
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
  plugins: [
    dedupePiCodingAgentNested,
    shimPiCodingAgentConfig,
    shimPiAiCompat,
    shimPiAiEnvApiKeys,
    shimSignalExit,
    shimDebug,
    copyToObsidian,
  ],
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
  loader: {
    '.svg': 'text',
  },
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
