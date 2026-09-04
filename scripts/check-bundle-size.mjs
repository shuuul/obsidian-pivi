#!/usr/bin/env node
/**
 * Fail CI when main.js exceeds the Obsidian community-plugin recommended ceiling (5 MB).
 * Run after `npm run build`.
 */

import { statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MAIN_JS = join(ROOT, 'main.js');
const MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${bytes.toLocaleString()} bytes (${mb.toFixed(2)} MB)`;
}

function checkBundleSizeAtPath(bundlePath) {
  let size;
  try {
    size = statSync(bundlePath).size;
  } catch {
    console.error(`Bundle size check failed: ${bundlePath} was not found. Run npm run build first.`);
    process.exit(1);
  }

  const headroom = MAX_BYTES - size;
  const headroomMb = headroom / (1024 * 1024);
  console.log(`main.js size: ${formatBytes(size)}`);
  console.log(`Obsidian limit headroom: ${formatBytes(Math.max(0, headroom))} (${headroomMb.toFixed(2)} MB below 5 MB cap)`);

  if (size > MAX_BYTES) {
    console.error(`Bundle size check failed: main.js exceeds the 5 MB Obsidian community-plugin limit.`);
    process.exit(1);
  }
}

function checkBundleSize() {
  checkBundleSizeAtPath(MAIN_JS);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkBundleSize();
}

export { checkBundleSize, checkBundleSizeAtPath, MAX_BYTES, MAIN_JS };
