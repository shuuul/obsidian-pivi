import fs from 'node:fs';
import path from 'node:path';

import {
  collectModuleSpecifiers,
  isForbidden,
  isLegacySrcImport,
  listSourceFiles,
  rootDir,
} from './check-helpers.mjs';

const boundaryRules = [
  {
    root: 'packages/pivi-agent-core/src/foundation',
    forbidden: [
      /^obsidian$/,
      /^electron$/,
      /^node:fs(?:\/|$)/,
      /^fs(?:\/|$)/,
      /^node:path(?:\/|$)/,
      /^path(?:\/|$)/,
      /^@earendil-works\//,
    ],
  },
  {
    root: 'packages/pivi-agent-core/src/tools',
    forbidden: [/^obsidian$/, /^electron$/, /^@earendil-works\//],
  },
  {
    root: 'src/ui',
    forbidden: [/^@earendil-works\//, /^@\/features\//, /^@\/utils\//, /^@\/main$/],
  },
  {
    root: 'packages/obsidian-tools',
    forbidden: [/^@earendil-works\//],
  },
];

const out = { packages: [], tests: [] };
const seen = new Set();

function add(scope, file, line, moduleName) {
  const key = `${scope}|${file}|${line}|${moduleName}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  out[scope].push({ file, line, moduleName });
}

for (const rule of boundaryRules) {
  for (const file of listSourceFiles(path.join(rootDir, rule.root))) {
    const relativeFile = path.relative(rootDir, file);
    for (const { moduleName, line } of collectModuleSpecifiers(file)) {
      if (isForbidden(moduleName, rule.forbidden)) {
        add('packages', relativeFile, line, moduleName);
      }
    }
  }
}

for (const file of listSourceFiles(path.join(rootDir, 'packages'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (isLegacySrcImport(moduleName, file)) {
      add('packages', relativeFile, line, moduleName);
    }
  }
}


for (const file of listSourceFiles(path.join(rootDir, 'tests'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (isLegacySrcImport(moduleName, file)) {
      add('tests', relativeFile, line, moduleName);
    }
  }
}

const target = path.join(rootDir, 'scripts/architecture-import-allowlist.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `Wrote ${out.packages.length} package, ${out.tests.length} test allowlist entries.`,
);