import fs from 'node:fs';
import path from 'node:path';

import { isExportOnlyFile, listSourceFiles, loadJsonConfig, rootDir } from './check-helpers.mjs';

const allowlistPath = 'scripts/legacy-src-allowlist.json';
const allowlist = loadJsonConfig(allowlistPath);
if (!allowlist) {
  console.error(`Missing ${allowlistPath}`);
  process.exit(1);
}

const srcRoot = path.join(rootDir, 'src');
const allSrcTs = listSourceFiles(srcRoot, { extensions: /\.ts$/ }).map((file) =>
  path.relative(rootDir, file).replaceAll('\\', '/'),
);

const fileCategory = new Map();
for (const entry of allowlist.files ?? []) {
  fileCategory.set(entry.path, entry.category);
}
for (const entry of allowlist.reexportOnly ?? []) {
  if (!fileCategory.has(entry)) {
    fileCategory.set(entry, 'REEXPORT_ONLY');
  }
}

const failures = [];
const unlisted = [];
const enforceFullInventory = allowlist.enforceFullSrcInventory === true;

for (const relativeFile of allSrcTs.sort()) {
  const category = fileCategory.get(relativeFile);
  if (!category) {
    if (enforceFullInventory) {
      unlisted.push(relativeFile);
    }
    continue;
  }
  if (category === 'REEXPORT_ONLY' && !isExportOnlyFile(relativeFile)) {
    failures.push({ file: relativeFile, reason: 'REEXPORT_ONLY must contain only export declarations and comments' });
  }
}

if (unlisted.length > 0) {
  console.error('Legacy src files missing from allowlist (add to scripts/legacy-src-allowlist.json):');
  for (const file of unlisted) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}


if (failures.length > 0) {
  console.error('Legacy allowlist shape violations:');
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.reason}`);
  }
  process.exit(1);
}

const counts = {};
for (const category of allowlist.categories ?? []) {
  counts[category] = 0;
}
for (const relativeFile of allSrcTs) {
  const category = fileCategory.get(relativeFile);
  if (category) {
    counts[category] = (counts[category] ?? 0) + 1;
  }
}

console.log(
  `Legacy src shape passed (${allSrcTs.length} files; allowlisted categories: ${Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${category}=${count}`)
    .join(', ')}).`,
);