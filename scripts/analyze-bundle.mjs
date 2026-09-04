#!/usr/bin/env node
/**
 * Emit esbuild metafile for bundle size analysis (see AGENTS.md Quality review snapshot → main.js size).
 * Run: node scripts/analyze-bundle.mjs
 * Open metafile.json with https://esbuild.github.io/analyze/
 */

import esbuild from 'esbuild';
import { writeFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value.`);
  return process.argv[index + 1];
}

const projectRoot = path.resolve(option('--project') ?? '.');
const outputPath = path.resolve(option('--output') ?? 'metafile.json');
const buildOptionsUrl = pathToFileURL(
  path.join(projectRoot, 'build/create-build-options.mjs'),
).href;
// eslint-disable-next-line no-unsanitized/method -- PR CI supplies a trusted checkout path so each revision uses its own build contract.
const { createBuildOptions } = await import(buildOptionsUrl);

const buildOptions = createBuildOptions({
  production: true,
  metafile: true,
  write: false,
});
const result = await esbuild.build({ ...buildOptions, absWorkingDir: projectRoot });

writeFileSync(outputPath, JSON.stringify(result.metafile));
console.log(`Wrote ${outputPath} — open at https://esbuild.github.io/analyze/`);
