import fs from 'node:fs';
import path from 'node:path';

import {
  collectModuleSpecifiers,
  isForbidden,
  isProductSrcImport,
  listSourceFiles,
  loadJsonConfig,
  resolveToSrcPath,
  rootDir,
} from './check-helpers.mjs';

const sourceRoots = ['packages', 'src'];
const srcAppWorkspaceDir = path.join(rootDir, 'src', 'app', 'workspace');

const fileBoundaryRules = [
  {
    name: 'src/app/hostContracts stays structural and implementation-free',
    file: 'src/app/hostContracts.ts',
    forbidden: [
      /^@pivi\/pivi-agent-core\/engine\/pi(?:\/|$)/,
      /^@\/app\/workspace(?:\/|$)/,
    ],
    resolvedForbiddenRoots: [srcAppWorkspaceDir],
  },
];

const boundaryRules = [
  {
    name: '@pivi/pivi-agent-core/foundation stays runtime and SDK free',
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
    name: '@pivi/pivi-agent-core/tools stays protocol-only',
    root: 'packages/pivi-agent-core/src/tools',
    forbidden: [/^obsidian$/, /^electron$/, /^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core stays host-neutral',
    root: 'packages/pivi-agent-core',
    forbidden: [
      /^obsidian$/,
      /^electron$/,
      /^@pivi\/obsidian-host(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
      /^@\/app(?:\/|$)/,
      /^@\/ui(?:\/|$)/,
    ],
  },
  {
    name: '@pivi/pivi-agent-core auth has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/auth',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core session has no direct filesystem writes',
    root: 'packages/pivi-agent-core/src/session',
    forbidden: [/^node:fs(?:\/|$)/, /^fs(?:\/|$)/],
  },
  {
    name: '@pivi/pivi-agent-core context has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/context',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core mcp has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/mcp',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core plugins has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/plugins',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core prompt has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/prompt',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core runtime has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/runtime',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core session has no raw Pi SDK imports',
    root: 'packages/pivi-agent-core/src/session',
    forbidden: [/^@earendil-works\//],
  },
  {
    name: '@pivi/pivi-agent-core skills has no host or process SDK imports',
    root: 'packages/pivi-agent-core/src/skills',
    forbidden: [
      /^obsidian$/,
      /^electron$/,
      /^@earendil-works\//,
      /^@pivi\/obsidian-host(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
      /^@\/app(?:\/|$)/,
      /^@\/ui(?:\/|$)/,
      /^node:child_process(?:\/|$)/,
      /^child_process(?:\/|$)/,
    ],
  },
  {
    name: '@pivi/pivi-agent-core ports stay dependency-free',
    root: 'packages/pivi-agent-core/src/ports',
    forbidden: [
      /^@pivi\//,
      /^@earendil-works\//,
      /^obsidian$/,
      /^electron$/,
      /^node:/,
      /^fs(?:\/|$)/,
      /^path(?:\/|$)/,
    ],
  },
  {
    name: 'src/ui does not import raw Pi SDKs, host adapters, or concrete tools',
    root: 'src/ui',
    forbidden: [
      /^@earendil-works\//,
      /^@pivi\/obsidian-tools(?:\/|$)/,
      /^@pivi\/obsidian-host(?:\/|$)/,
    ],
  },
  {
    name: 'src/ui does not import Pi engine implementations',
    root: 'src/ui',
    forbidden: [/^@pivi\/pivi-agent-core\/engine\/pi(?:\/|$)/],
  },
  {
    name: 'src/ui does not import app workspace implementation modules',
    root: 'src/ui',
    forbidden: [/^@\/app\/workspace(?:\/|$)/],
    resolvedForbiddenRoots: [srcAppWorkspaceDir],
  },
  {
    name: 'src/app/workspace does not import product UI modules',
    root: 'src/app/workspace',
    forbidden: [/^@\/ui(?:\/|$)/],
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
      /^@pivi\/pivi-agent-core\/engine\/pi(?:\/|$)/,
      /^@pivi\/pivi-agent-core\/skills(?:\/|$)/,
      /^@pivi\/pivi-agent-core\/tools(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
    ],
  },
  {
    name: 'src/ui uses current app/ui aliases only',
    root: 'src/ui',
    forbidden: [/^@\/features\//, /^@\/utils\//, /^@\/main$/],
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

function isPathInside(candidatePath, directoryPath) {
  const relative = path.relative(directoryPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvesToForbiddenRoot(moduleName, fromFile, forbiddenRoots) {
  if (!forbiddenRoots?.length) {
    return false;
  }
  const resolved = resolveToSrcPath(moduleName, fromFile);
  return Boolean(resolved && forbiddenRoots.some((root) => isPathInside(resolved, root)));
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
      if (
        isForbidden(moduleName, rule.forbidden)
        || resolvesToForbiddenRoot(moduleName, file, rule.resolvedForbiddenRoots)
      ) {
        pushFailure('packages', { rule: rule.name, file: relativeFile, line, moduleName });
      }
    }
  }
}

for (const rule of fileBoundaryRules) {
  const file = path.join(rootDir, rule.file);
  if (!fs.existsSync(file)) {
    continue;
  }
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (
      isForbidden(moduleName, rule.forbidden)
      || resolvesToForbiddenRoot(moduleName, file, rule.resolvedForbiddenRoots)
    ) {
      pushFailure('packages', { rule: rule.name, file: relativeFile, line, moduleName });
    }
  }
}

for (const file of listSourceFiles(path.join(rootDir, 'packages'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line } of collectModuleSpecifiers(file)) {
    if (isProductSrcImport(moduleName, file)) {
      pushFailure('packages', {
        rule: 'packages must not import product src/** or @/* aliases',
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
    if (isProductSrcImport(moduleName, file)) {
      pushFailure('tests', {
        rule: 'tests must not import product src/** relative paths into src/',
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
    `Architecture boundaries passed with ${allowlistTotal} allowlisted product-src import(s): packages=${allowlistByScope.packages}, tests=${allowlistByScope.tests}.`,
  );
} else {
  console.log('Architecture boundaries passed.');
}
