#!/usr/bin/env node
/**
 * CSS Build Script
 * Concatenates modular CSS files from @pivi/obsidian-ui into root styles.css
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

import { styleModules } from '../packages/obsidian-ui/styles/manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STYLE_DIR = join(ROOT, 'packages', 'obsidian-ui', 'styles');
const OUTPUT = join(ROOT, 'styles.css');
const isProduction = process.argv.includes('--production');

export function minifyCss(css) {
  const preservedComments = [];
  const withPlaceholders = css.replace(/\/\*\s*@settings[\s\S]*?\*\//g, (comment) => {
    const placeholder = `___PIVI_PRESERVED_COMMENT_${preservedComments.length}___`;
    preservedComments.push(comment.trim());
    return placeholder;
  });

  return withPlaceholders
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .trim()
    .replace(/___PIVI_PRESERVED_COMMENT_(\d+)___/g, (_match, index) => preservedComments[Number(index)] ?? '');
}

function getModuleOrder() {
  if (!Array.isArray(styleModules) || styleModules.length === 0) {
    console.error('No CSS modules found in packages/obsidian-ui/styles/manifest.mjs');
    process.exit(1);
  }

  return styleModules;
}

function listCssFiles(dir, baseDir = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listCssFiles(entryPath, baseDir));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.css')) {
      const relativePath = relative(baseDir, entryPath).split('\\').join('/');
      files.push(relativePath);
    }
  }

  return files;
}

function build() {
  const moduleOrder = getModuleOrder();
  const parts = ['/* Pivi Plugin Styles */\n/* Built from src/styles/ modules */\n'];
  const missingFiles = [];
  const invalidImports = [];
  const normalizedImports = [];

  for (const modulePath of moduleOrder) {
    const resolvedPath = resolve(STYLE_DIR, modulePath);
    const relativePath = relative(STYLE_DIR, resolvedPath);

    if (relativePath.startsWith('..') || !relativePath.endsWith('.css')) {
      invalidImports.push(modulePath);
      continue;
    }

    const normalizedPath = relativePath.split('\\').join('/');
    normalizedImports.push(normalizedPath);

    if (!existsSync(resolvedPath)) {
      missingFiles.push(normalizedPath);
      continue;
    }

    const content = readFileSync(resolvedPath, 'utf-8');
    const header = `\n/* ============================================\n   ${normalizedPath}\n   ============================================ */\n`;
    parts.push(header + content);
  }

  let hasErrors = false;

  if (invalidImports.length > 0) {
    console.error('Invalid entries in packages/obsidian-ui/styles/manifest.mjs:');
    invalidImports.forEach((modulePath) => console.error(`  - ${modulePath}`));
    hasErrors = true;
  }

  if (missingFiles.length > 0) {
    console.error('Missing CSS files:');
    missingFiles.forEach((f) => console.error(`  - ${f}`));
    hasErrors = true;
  }

  const allCssFiles = listCssFiles(STYLE_DIR);
  const importedSet = new Set(normalizedImports);
  const unlistedFiles = allCssFiles.filter((file) => !importedSet.has(file));

  if (unlistedFiles.length > 0) {
    console.error('Unlisted CSS files (not listed in packages/obsidian-ui/styles/manifest.mjs):');
    unlistedFiles.forEach((file) => console.error(`  - ${file}`));
    hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  const raw = parts.join('\n');
  const output = isProduction ? minifyCss(raw) : raw;
  writeFileSync(OUTPUT, output);
  const mode = isProduction ? 'minified' : 'dev';
  console.log(`Built styles.css (${mode}, ${(output.length / 1024).toFixed(1)} KB)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
}
