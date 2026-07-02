import fs from 'node:fs';
import path from 'node:path';

import {
  collectModuleSpecifiers,
  isForbidden,
  isLegacySrcImport,
  listSourceFiles,
  loadJsonConfig,
  rootDir,
} from './check-helpers.mjs';

const sourceRoots = ['packages', 'src'];

const boundaryRules = [
  {
    name: '@pivi/core stays runtime and SDK free',
    root: 'packages/core',
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
    name: '@pivi/tools stays protocol-only',
    root: 'packages/tools',
    forbidden: [/^obsidian$/, /^electron$/, /^@earendil-works\//],
  },
  {
    name: 'src/ui does not import raw Pi SDKs or concrete tool implementations',
    root: 'src/ui',
    forbidden: [/^@earendil-works\//, /^@pivi\/obsidian-tools(?:\/|$)/],
  },
  {
    name: '@pivi/obsidian-tools does not import raw Pi SDKs',
    root: 'packages/obsidian-tools',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/obsidian-host stays host-only',
    root: 'packages/obsidian-host',
    forbidden: [
      /^@pivi\/pi-runtime(?:\/|$)/,
      /^@pivi\/skills(?:\/|$)/,
      /^@pivi\/tools(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
    ],
  },
  {
    name: '@pivi/pi-runtime does not import plugin UI',
    root: 'packages/pi-runtime',
    forbidden: [/^@\/ui(?:\/|$)/],
  },
  {
    name: '@pivi/mcp does not import Pi SDK packages',
    root: 'packages/mcp',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/skills avoids plugin UI and composition imports',
    root: 'packages/skills',
    forbidden: [/^obsidian$/, /^@\/main$/, /^@\/features\//, /^@\/ui(?:\/|$)/],
  },
  {
    name: 'src/ui does not import legacy src/features or src/utils aliases',
    root: 'src/ui',
    forbidden: [/^@\/features\//, /^@\/utils\//, /^@\/main$/],
  },
  {
    name: '@pivi/pi-runtime does not import legacy src/pi, src/utils, or plugin main',
    root: 'packages/pi-runtime',
    forbidden: [/^@\/pi\//, /^@\/utils\//, /^@\/main$/],
  },
];

const importAllowlist = loadJsonConfig('scripts/architecture-import-allowlist.json') ?? {
  packages: [],
  tests: [],
};

function allowlistKey(scope, file, line, moduleName) {
  return `${scope}|${file}|${line}|${moduleName}`;
}

function buildAllowlistSet(scope, entries) {
  const set = new Set();
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      set.add(entry);
      continue;
    }
    const { file, line, moduleName } = entry;
    if (file && line && moduleName) {
      set.add(allowlistKey(scope, file, line, moduleName));
    }
  }
  return set;
}

const allowlistedImports = {
  packages: buildAllowlistSet('packages', importAllowlist.packages),
  tests: buildAllowlistSet('tests', importAllowlist.tests),
};

function formatFailure({ rule, file, line, moduleName }) {
  return `- ${file}:${line} imports "${moduleName}" (${rule})`;
}

const failures = [];
const allowlistedViolations = [];

function pushFailure(scope, payload) {
  const key = allowlistKey(scope, payload.file, payload.line, payload.moduleName);
  const allowSet = allowlistedImports[scope];
  if (allowSet?.has(key)) {
    allowlistedViolations.push({ scope, ...payload });
    return;
  }
  failures.push(payload);
}

for (const rule of boundaryRules) {
  for (const file of listSourceFiles(path.join(rootDir, rule.root))) {
    const relativeFile = path.relative(rootDir, file);
    for (const { moduleName, line } of collectModuleSpecifiers(file)) {
      if (isForbidden(moduleName, rule.forbidden)) {
        pushFailure('packages', { rule: rule.name, file: relativeFile, line, moduleName });
      }
    }
  }
}

for (const file of listSourceFiles(path.join(rootDir, 'packages'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (isLegacySrcImport(moduleName, file)) {
      pushFailure('packages', {
        rule: 'packages must not import legacy src/** or @/* aliases',
        file: relativeFile,
        line,
        moduleName,
      });
    }
  }
}


for (const file of listSourceFiles(path.join(rootDir, 'tests'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (isLegacySrcImport(moduleName, file)) {
      pushFailure('tests', {
        rule: 'tests must not import legacy src/** relative paths into src/',
        file: relativeFile,
        line,
        moduleName,
      });
    }
  }
}

const pluginBaseImports = [];
for (const root of sourceRoots) {
  for (const file of listSourceFiles(path.join(rootDir, root))) {
    const relativeFile = path.relative(rootDir, file);
    for (const { moduleName, line } of collectModuleSpecifiers(file)) {
      if (moduleName !== 'obsidian') {
        continue;
      }
      const sourceText = fs.readFileSync(file, 'utf8');
      if (/import\s*\{[^}]*\bPlugin\b/.test(sourceText) && relativeFile !== 'src/main.ts') {
        pluginBaseImports.push({ file: relativeFile, line, moduleName });
      }
    }
  }
}

for (const failure of pluginBaseImports) {
  failures.push({
    rule: 'src/main.ts is the only Obsidian Plugin composition root',
    ...failure,
  });
}

if (failures.length > 0) {
  const grouped = new Map();
  for (const failure of failures) {
    const list = grouped.get(failure.rule) ?? [];
    list.push(failure);
    grouped.set(failure.rule, list);
  }
  console.error('Architecture boundary violations found:');
  for (const [rule, items] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`\n[${rule}] (${items.length})`);
    for (const item of items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.error(formatFailure(item));
    }
  }
  process.exit(1);
}

const uniqueAllowlisted = new Set(
  allowlistedViolations.map((item) => allowlistKey(item.scope, item.file, item.line, item.moduleName)),
);
const allowlistTotal = uniqueAllowlisted.size;
const allowlistByScope = {
  packages: [...uniqueAllowlisted].filter((key) => key.startsWith('packages|')).length,
  tests: [...uniqueAllowlisted].filter((key) => key.startsWith('tests|')).length,
};
if (allowlistTotal > 0) {
  console.log(
    `Architecture boundaries passed with ${allowlistTotal} allowlisted legacy import(s): packages=${allowlistByScope.packages}, tests=${allowlistByScope.tests}.`,
  );
} else {
  console.log('Architecture boundaries passed.');
}
