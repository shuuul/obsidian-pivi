#!/usr/bin/env node
/**
 * Combined build script - runs CSS build then Rolldown
 * Avoids npm echoing commands
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// CSS must finish before the watch or production build can deploy.
const buildArgs = process.argv.slice(2);
const cssArgs = buildArgs.includes('production') ? ['--production'] : [];
const options = { cwd: ROOT, stdio: 'inherit' };
execFileSync(process.execPath, ['scripts/build-css.mjs', ...cssArgs], options);
execFileSync(process.execPath, ['rolldown.config.mjs', ...buildArgs], options);
