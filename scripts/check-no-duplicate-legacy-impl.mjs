import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isExportOnlyFile, rootDir } from './check-helpers.mjs';

const allowlist = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'scripts/legacy-src-allowlist.json'), 'utf8'),
);

const reexportOnlyPaths = new Set([
  ...(allowlist.reexportOnly ?? []),
  ...(allowlist.files ?? [])
    .filter((entry) => entry.category === 'REEXPORT_ONLY')
    .map((entry) => entry.path),
]);

const enforcedFailures = [...reexportOnlyPaths]
  .sort()
  .filter((file) => !isExportOnlyFile(file));

if (enforcedFailures.length > 0) {
  console.error('Legacy REEXPORT_ONLY files must contain only export declarations and comments:');
  for (const file of enforcedFailures) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Legacy re-export checks passed (${reexportOnlyPaths.size} REEXPORT_ONLY paths).`);

const shape = spawnSync(process.execPath, ['scripts/check-legacy-src-shape.mjs'], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (shape.status !== 0) {
  process.exit(shape.status ?? 1);
}