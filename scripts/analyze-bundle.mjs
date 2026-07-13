#!/usr/bin/env node
/**
 * Emit esbuild metafile for bundle size analysis (see AGENTS.md Quality review snapshot → main.js size).
 * Run: node scripts/analyze-bundle.mjs
 * Open metafile.json with https://esbuild.github.io/analyze/
 */

import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import { createBuildOptions } from '../build/create-build-options.mjs';

const result = await esbuild.build(createBuildOptions({
  production: true,
  metafile: true,
  write: false,
}));

writeFileSync('metafile.json', JSON.stringify(result.metafile));
console.log('Wrote metafile.json — open at https://esbuild.github.io/analyze/');
