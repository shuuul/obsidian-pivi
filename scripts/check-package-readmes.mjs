import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const packagesDir = path.join(rootDir, 'packages');
const requiredHeadings = [
  '## Purpose',
  '## Allowed dependencies',
  '## Forbidden dependencies',
  '## Public API',
];

const packageDirs = fs
  .readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(packagesDir, entry.name))
  .sort();

const failures = [];

for (const packageDir of packageDirs) {
  const relativePackageDir = path.relative(rootDir, packageDir);
  const readmePath = path.join(packageDir, 'README.md');
  if (!fs.existsSync(readmePath)) {
    failures.push(`${relativePackageDir}/README.md is missing`);
    continue;
  }

  const contents = fs.readFileSync(readmePath, 'utf8');
  for (const heading of requiredHeadings) {
    if (!contents.includes(heading)) {
      failures.push(`${relativePackageDir}/README.md is missing ${heading}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Package README coverage check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Package README coverage passed.');
