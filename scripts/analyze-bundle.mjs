#!/usr/bin/env node
/**
 * Emit esbuild metafile for bundle size analysis (quality review P2 #21).
 * Run: node scripts/analyze-bundle.mjs
 * Open metafile.json with https://esbuild.github.io/analyze/
 */

import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const piCodingAgentConfigShim = path.join(rootDir, '../src/pi/shims/piCodingAgentConfig.ts');
const piCodingAgentConfigPath = path.join(
  rootDir,
  '../node_modules/@earendil-works/pi-coding-agent/dist/config.js',
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

const result = await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2018',
  outfile: 'metafile-main.js',
  metafile: true,
  treeShaking: true,
  minify: true,
  plugins: [shimPiCodingAgentConfig],
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
  write: false,
});

writeFileSync('metafile.json', JSON.stringify(result.metafile));
console.log('Wrote metafile.json — open at https://esbuild.github.io/analyze/');
