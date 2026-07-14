import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import {
  collectModuleSpecifiers,
  collectNamedExportSpecifiers,
  collectNamedMethodCalls,
  collectNamedPropertyAccesses,
  collectNamedReceiverPropertyAccesses,
  isForbidden,
  isProductSrcImport,
  isRelativeProductSrcImport,
  listSourceFiles,
  loadJsonConfig,
  resolveToSrcPath,
  resolveSourceModuleFile,
  rootDir,
} from './check-helpers.mjs';

const sourceRoots = ['packages', 'src'];
const srcAppWorkspaceDir = path.join(rootDir, 'src', 'app', 'workspace');
const srcAppDir = path.join(rootDir, 'src', 'app');
const srcAppUiDir = path.join(rootDir, 'src', 'app', 'ui');
const imperativeChatBoundaryFiles = [
  'imperativeChatAdapter.ts',
  'imperativeChatViewHandle.ts',
  'imperativeChatMessagePresentation.ts',
].map((name) => path.join(srcAppUiDir, name));
const imperativeChatBoundaryFileSet = new Set(imperativeChatBoundaryFiles);
const obsidianReactDir = path.join(rootDir, 'packages', 'pivi-react');
const piviReactStylesDir = path.join(obsidianReactDir, 'styles');
const piviReactSourceDir = path.join(obsidianReactDir, 'src');
const piviReactPortsDir = path.join(piviReactSourceDir, 'ports');
const piviReactLocalesDir = path.join(piviReactSourceDir, 'i18n', 'locales');
const obsidianReactPackagePattern = /^@pivi\/pivi-react(?:\/|$)/;
const retiredReactPackagePattern = new RegExp(
  '^@pivi/' + ['obsidian', '(?:ui|react)'].join('-') + '(?:/|$)',
);

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
  {
    name: 'PiviViewHost does not import chat aggregate implementations',
    file: 'src/app/ui/PiviViewHost.ts',
    forbidden: [/^@\/ui\/chat\/tabs\/(?:TabManager|types)$/],
  },
];

const boundaryRules = [
  {
    name: 'src does not reference the retired React package identity',
    root: 'src',
    forbidden: [retiredReactPackagePattern],
  },
  {
    name: 'packages do not reference the retired React package identity',
    root: 'packages',
    forbidden: [retiredReactPackagePattern],
  },
  {
    name: '@pivi/pivi-react stays presentation-only and product-neutral',
    root: 'packages/pivi-react',
    forbidden: [
      /^@\//,
      /^src(?:\/|$)/,
      /^@earendil-works\//,
      /^@pivi\/pivi-agent-core$/,
      /^@pivi\/pivi-agent-core\/engine\/pi(?:\/|$)/,
      /^@pivi\/pivi-agent-core\/runtime(?:$|\/chatPorts(?:\/|$))/,
      /^@pivi\/obsidian-host(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
      /^obsidian(?:\/|$)/,
      /^electron(?:\/|$)/,
      /^node:/,
      /^fs(?:\/|$)/,
      /^path(?:\/|$)/,
    ],
  },
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
      /^@pivi\/pivi-react(?:\/|$)/,
      /^@codemirror\//,
      /^react(?:\/|$)/,
      /^react-dom(?:\/|$)/,
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
    name: 'src/ui uses only approved @pivi/pivi-react presentation subpaths',
    root: 'src/ui',
    forbidden: [
      /^@pivi\/pivi-react(?:$|\/(?!(?:store|inline-edit|context-badges)$))/,
    ],
    resolvedForbiddenRoots: [obsidianReactDir],
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
    name: 'only src/app/ui mounts @pivi/pivi-react surfaces',
    root: 'src',
    forbidden: [/^@pivi\/pivi-react\/mount(?:\/|$)/],
    excludedRoots: [srcAppUiDir],
  },
  {
    name: 'only src/app/ui imports @pivi/pivi-react presentation ports',
    root: 'src',
    forbidden: [/^@pivi\/pivi-react\/ports(?:\/|$)/],
    excludedRoots: [srcAppUiDir],
  },
  {
    name: '@pivi/obsidian-tools does not import raw Pi SDKs',
    root: 'packages/obsidian-tools',
    forbidden: [/^@earendil-works\//, obsidianReactPackagePattern],
  },
  {
    name: '@pivi/obsidian-host stays host-only',
    root: 'packages/obsidian-host',
    forbidden: [
      /^@pivi\/pivi-agent-core\/engine\/pi(?:\/|$)/,
      /^@pivi\/pivi-agent-core\/skills(?:\/|$)/,
      /^@pivi\/pivi-agent-core\/tools(?:\/|$)/,
      /^@pivi\/obsidian-tools(?:\/|$)/,
      obsidianReactPackagePattern,
    ],
  },
  {
    name: 'src/ui does not import src/app/ui composition adapters',
    root: 'src/ui',
    forbidden: [/^@\/app\/ui(?:\/|$)/],
    resolvedForbiddenRoots: [srcAppUiDir],
  },
  {
    name: 'only imperativeChatAdapter imports chat aggregate implementations',
    root: 'src/app',
    forbidden: [/^@\/ui\/chat\/tabs\/(?:TabManager|types)$/],
    excludedRoots: imperativeChatBoundaryFiles,
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

function formatFailure({ rule, file, line, moduleName, methodName, detail }) {
  if (detail) {
    return `- ${file}:${line} ${detail} (${rule})`;
  }
  if (methodName) {
    return `- ${file}:${line} calls forbidden method "${methodName}" (${rule})`;
  }
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

const architectureSourceFiles = sourceRoots
  .flatMap(root => listSourceFiles(path.join(rootDir, root)))
  .map(file => path.resolve(file));
const architectureSourceFileSet = new Set(architectureSourceFiles);
const valueImportGraph = new Map(architectureSourceFiles.map(file => [
  file,
  collectModuleSpecifiers(file)
    .filter(specifier => !specifier.isTypeOnly)
    .map(specifier => resolveSourceModuleFile(specifier.moduleName, file, architectureSourceFileSet))
    .filter(Boolean),
]));
const visitedValueImports = new Set();
const activeValueImports = new Set();
const valueImportStack = [];
const reportedValueCycles = new Set();

function visitValueImports(file) {
  if (visitedValueImports.has(file)) return;
  if (activeValueImports.has(file)) {
    const cycleStart = valueImportStack.indexOf(file);
    const cycle = [...valueImportStack.slice(cycleStart), file];
    const cycleKey = [...new Set(cycle)].sort().join('|');
    if (!reportedValueCycles.has(cycleKey)) {
      reportedValueCycles.add(cycleKey);
      failures.push({
        rule: 'source modules have no circular value imports',
        file: path.relative(rootDir, file),
        line: 1,
        moduleName: cycle.map(entry => path.relative(rootDir, entry)).join(' -> '),
      });
    }
    return;
  }

  activeValueImports.add(file);
  valueImportStack.push(file);
  for (const dependency of valueImportGraph.get(file) ?? []) {
    visitValueImports(dependency);
  }
  valueImportStack.pop();
  activeValueImports.delete(file);
  visitedValueImports.add(file);
}

for (const file of architectureSourceFiles) visitValueImports(file);

for (const rule of boundaryRules) {
  for (const file of listSourceFiles(path.join(rootDir, rule.root))) {
    if (rule.excludedRoots?.some((excludedRoot) => isPathInside(file, excludedRoot))) {
      continue;
    }
    const relativeFile = path.relative(rootDir, file);
    for (const { moduleName, line, isTypeOnly } of collectModuleSpecifiers(file)) {
      if (rule.allowTypeOnly && isTypeOnly) {
        continue;
      }
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

for (const file of listSourceFiles(path.join(rootDir, 'src', 'ui'))) {
  const relativeFile = path.relative(rootDir, file);
  const forbiddenCapabilities = [
    'getUiFacades',
    'getPiWorkspace',
    'saveSettings',
    'getAllViews',
  ];
  const bypasses = [];
  for (const forbiddenMethod of forbiddenCapabilities) {
    bypasses.push(...collectNamedMethodCalls(file, forbiddenMethod));
  }
  bypasses.push(...collectNamedPropertyAccesses(file, forbiddenCapabilities));
  const seenBypass = new Set();
  for (const { methodName, line } of bypasses) {
    const identity = `${methodName}:${line}`;
    if (seenBypass.has(identity)) continue;
    seenBypass.add(identity);
    failures.push({
      rule: 'src/ui uses injected ChatPorts instead of plugin capability bypasses',
      file: relativeFile,
      line,
      methodName,
    });
  }
  for (const { methodName, line } of collectNamedExportSpecifiers(file, forbiddenCapabilities)) {
    failures.push({
      rule: 'src/ui uses injected ChatPorts instead of plugin capability bypasses',
      file: relativeFile,
      line,
      methodName,
      detail: `re-exports forbidden capability "${methodName}"`,
    });
  }
}

const allowedUiAppValueModules = new Set([
  path.join(srcAppDir, 'hostPlatform'),
  path.join(srcAppDir, 'i18n'),
]);
const allowedUiAppTypeModules = new Set([
  path.join(srcAppDir, 'hostContracts'),
]);

function withoutTypeScriptExtension(file) {
  return file.replace(/\.(?:cts|mts|tsx?|jsx?)$/, '');
}

for (const file of listSourceFiles(path.join(rootDir, 'src', 'ui'))) {
  const relativeFile = path.relative(rootDir, file);
  for (const { moduleName, line, isTypeOnly } of collectModuleSpecifiers(file)) {
    const resolved = resolveToSrcPath(moduleName, file);
    if (!resolved || !isPathInside(resolved, srcAppDir)) {
      continue;
    }
    const canonical = withoutTypeScriptExtension(resolved);
    const allowed = allowedUiAppValueModules.has(canonical)
      || isTypeOnly && allowedUiAppTypeModules.has(canonical);
    if (!allowed) {
      failures.push({
        rule: 'src/ui imports only approved app seams',
        file: relativeFile,
        line,
        moduleName,
      });
    }
  }
}

const appViewBoundaryFiles = [
  ...listSourceFiles(path.join(rootDir, 'src', 'app')),
  path.join(rootDir, 'src', 'main.ts'),
].filter(file => fs.existsSync(file) && !imperativeChatBoundaryFileSet.has(file));

for (const file of appViewBoundaryFiles) {
  const relativeFile = path.relative(rootDir, file);
  for (const methodName of ['getTabManager', 'getActiveTab']) {
    for (const call of collectNamedMethodCalls(file, methodName)) {
      failures.push({
        rule: 'app uses semantic PiviChatViewHandle instead of chat aggregates',
        file: relativeFile,
        ...call,
      });
    }
  }
  for (const access of collectNamedPropertyAccesses(file, [
    'controllers',
    'inlineContextManager',
    'externalContextSelector',
  ])) {
    failures.push({
      rule: 'app does not inspect TabData controller or UI graphs',
      file: relativeFile,
      ...access,
    });
  }
  for (const access of collectNamedReceiverPropertyAccesses(
    file,
    ['tab', 'activeTab', 'currentTab', 'candidateTab', 'targetTab'],
    ['dom', 'state'],
  )) {
    failures.push({
      rule: 'app does not inspect TabData state or DOM graphs',
      file: relativeFile,
      ...access,
    });
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
    if (isRelativeProductSrcImport(moduleName, file)) {
      pushFailure('tests', {
        rule: 'tests must not import product src/** relative paths into src/',
        file: relativeFile,
        line,
        moduleName,
      });
    }
  }
}

function listWorkspacePackageManifests() {
  const packagesDir = path.join(rootDir, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(packagesDir, entry.name, 'package.json'))
    .filter(file => fs.existsSync(file));
}

function exportedSubpathMatches(exportsField, subpath) {
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    return subpath === '.';
  }
  if (!exportsField || typeof exportsField !== 'object') return false;
  return Object.keys(exportsField).some((key) => {
    if (key === subpath) return true;
    const star = key.indexOf('*');
    if (star < 0) return false;
    return subpath.startsWith(key.slice(0, star)) && subpath.endsWith(key.slice(star + 1));
  });
}

const workspacePackages = listWorkspacePackageManifests().map((manifestFile) => {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  return { exports: manifest.exports, name: manifest.name };
}).filter(pkg => typeof pkg.name === 'string');

for (const root of [...sourceRoots, 'tests']) {
  for (const file of listSourceFiles(path.join(rootDir, root))) {
    const relativeFile = path.relative(rootDir, file);
    for (const { moduleName, line } of collectModuleSpecifiers(file)) {
      const pkg = workspacePackages.find(candidate =>
        moduleName === candidate.name || moduleName.startsWith(`${candidate.name}/`));
      if (!pkg) continue;
      const subpath = moduleName === pkg.name
        ? '.'
        : `./${moduleName.slice(pkg.name.length + 1)}`;
      if (!exportedSubpathMatches(pkg.exports, subpath)) {
        failures.push({
          rule: '@pivi imports use declared package exports',
          file: relativeFile,
          line,
          moduleName,
        });
      }
    }
  }
}

function containsRetiredPackageIdentity(value) {
  if (typeof value === 'string') return retiredReactPackagePattern.test(value);
  if (Array.isArray(value)) return value.some(containsRetiredPackageIdentity);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    retiredReactPackagePattern.test(key) || containsRetiredPackageIdentity(child));
}

for (const manifestFile of [path.join(rootDir, 'package.json'), ...listWorkspacePackageManifests()]) {
  if (!fs.existsSync(manifestFile)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (containsRetiredPackageIdentity(manifest)) {
    failures.push({
      rule: 'package manifests do not reference the retired React package identity',
      file: path.relative(rootDir, manifestFile),
      line: 1,
      moduleName: '<retired-react-package>',
    });
  }
}

function listCssFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return listCssFiles(target);
    return entry.isFile() && entry.name.endsWith('.css') ? [target] : [];
  });
}

const forbiddenHostClassNames = new Set([
  'checkbox-container',
  'modal',
  'svg-icon',
  'theme-dark',
  'theme-light',
]);

function isForbiddenHostClassName(className) {
  return className === 'setting-item'
    || className.startsWith('setting-item-')
    || className.startsWith('modal-')
    || className.startsWith('mod-')
    || forbiddenHostIdentifierTerm(className) !== null
    || forbiddenHostClassNames.has(className);
}

function sourceLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function collectStaticStringValues(node) {
  const values = [];

  function fullyStaticString(current) {
    if (ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
      return current.text;
    }
    if (
      ts.isBinaryExpression(current)
      && current.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = fullyStaticString(current.left);
      const right = fullyStaticString(current.right);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isTemplateExpression(current)) {
      let value = current.head.text;
      for (const span of current.templateSpans) {
        const expression = fullyStaticString(span.expression);
        if (expression === null) return null;
        value += expression + span.literal.text;
      }
      return value;
    }
    return null;
  }

  function visit(current) {
    const staticValue = fullyStaticString(current);
    if (staticValue !== null) {
      values.push({ node: current, value: staticValue });
      return;
    }
    if (ts.isTemplateExpression(current)) {
      values.push({ node: current.head, value: current.head.text });
      for (const span of current.templateSpans) {
        visit(span.expression);
        values.push({ node: span.literal, value: span.literal.text });
      }
      return;
    }
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return values;
}

function pushForbiddenClassTokens(file, sourceFile, valueNode, rule) {
  for (const { node, value } of collectStaticStringValues(valueNode)) {
    for (const className of value.split(/\s+/).filter(Boolean)) {
      if (!isForbiddenHostClassName(className)) continue;
      failures.push({
        rule,
        file: path.relative(rootDir, file),
        line: sourceLine(sourceFile, node),
        detail: `uses forbidden host class "${className}"`,
      });
    }
  }
}

for (const file of listSourceFiles(piviReactSourceDir)) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  function visit(node) {
    if (
      ts.isJsxAttribute(node)
      && node.name.getText(sourceFile) === 'className'
      && node.initializer
    ) {
      const valueNode = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      pushForbiddenClassTokens(
        file,
        sourceFile,
        valueNode,
        '@pivi/pivi-react JSX uses product-owned CSS classes',
      );
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (
        methodName === 'setAttribute'
        && ts.isStringLiteralLike(node.arguments[0])
        && node.arguments[0].text === 'class'
      ) {
        pushForbiddenClassTokens(
          file,
          sourceFile,
          node.arguments[1],
          '@pivi/pivi-react DOM adapters use product-owned CSS classes',
        );
      }

      if (
        ['add', 'remove', 'replace', 'toggle'].includes(methodName)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === 'classList'
      ) {
        for (const argument of node.arguments) {
          pushForbiddenClassTokens(
            file,
            sourceFile,
            argument,
            '@pivi/pivi-react DOM adapters use product-owned CSS classes',
          );
        }
      }
    }
    if (
      ts.isBinaryExpression(node)
      && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(
        node.operatorToken.kind,
      )
      && ts.isPropertyAccessExpression(node.left)
      && node.left.name.text === 'className'
    ) {
      pushForbiddenClassTokens(
        file,
        sourceFile,
        node.right,
        '@pivi/pivi-react DOM adapters use product-owned CSS classes',
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function identifierWords(identifier) {
  return identifier
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z\d]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase());
}

function forbiddenHostIdentifierTerm(identifier) {
  const words = identifierWords(identifier);
  const forbiddenWord = words.find(word => ['obsidian', 'vault', 'keychain'].includes(word));
  if (forbiddenWord) return forbiddenWord;
  for (let index = 0; index < words.length - 1; index += 1) {
    if (words[index] === 'secret' && words[index + 1] === 'storage') return 'SecretStorage';
  }
  return null;
}

function declarationNameText(name, sourceFile) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return name.getText(sourceFile);
}

for (const file of listSourceFiles(piviReactPortsDir)) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  function visit(node) {
    const isPublicPortDeclaration = ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isPropertySignature(node)
      || ts.isMethodSignature(node)
      || ts.isEnumDeclaration(node)
      || ts.isEnumMember(node)
      || ts.isExportSpecifier(node)
      || ts.isNamespaceExport(node);
    if (isPublicPortDeclaration) {
      const identifier = declarationNameText(node.name, sourceFile);
      const forbiddenTerm = identifier && forbiddenHostIdentifierTerm(identifier);
      if (forbiddenTerm) {
        failures.push({
          rule: '@pivi/pivi-react public ports use host-neutral identifiers',
          file: path.relative(rootDir, file),
          line: sourceLine(sourceFile, node.name ?? node),
          detail: `exposes host-specific identifier "${identifier}" (${forbiddenTerm})`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  });
}

function findJsonValue(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

const parameterizedLocaleValues = new Map([
  ['settings.webSearch.apiKeyDesc', ['secureStorageName']],
  ['settings.webSearch.apiKeySavedPlaceholder', ['secureStorageName']],
  ['settings.tools.intro', ['hostName']],
  ['settings.modelsTab.intro', ['secureStorageName']],
  ['settings.modelsTab.secureStorageRequired', ['hostName', 'secureStorageName']],
  ['settings.modelsTab.apiKeyDesc', ['secureStorageName']],
  ['settings.modelsTab.apiKeySavedPlaceholder', ['secureStorageName']],
  ['settings.modelsTab.oauthTokenDesc', ['secureStorageName']],
  ['settings.modelsTab.oauthTokenSavedPlaceholder', ['secureStorageName']],
  ['settings.modelsTab.codex.desc', ['secureStorageName']],
  ['settings.modelsTab.apiKeyOptionalDesc', ['secureStorageName']],
  ['settings.slashCommands.desc', ['workspaceName']],
  ['settings.skills.defaultBundle.name', ['hostName']],
  ['settings.skills.defaultBundle.desc', ['workspaceName']],
]);

for (const file of listJsonFiles(piviReactLocalesDir)) {
  const sourceText = fs.readFileSync(file, 'utf8');
  let locale;
  try {
    locale = JSON.parse(sourceText);
  } catch {
    continue;
  }

  function visitLocaleKeys(value, keyPath = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenHostIdentifierTerm(key)) {
        const needle = `"${key}"`;
        const offset = sourceText.indexOf(needle);
        failures.push({
          rule: '@pivi/pivi-react locale keys use host-neutral terminology',
          file: path.relative(rootDir, file),
          line: offset < 0 ? 1 : sourceText.slice(0, offset).split('\n').length,
          detail: `uses host-specific locale key "${[...keyPath, key].join('.')}"`,
        });
      }
      visitLocaleKeys(child, [...keyPath, key]);
    }
  }
  visitLocaleKeys(locale);

  for (const [keyPath, placeholders] of parameterizedLocaleValues) {
    const value = findJsonValue(locale, keyPath);
    if (typeof value !== 'string') {
      failures.push({
        rule: '@pivi/pivi-react locale copy parameterizes host terminology',
        file: path.relative(rootDir, file),
        line: 1,
        detail: `is missing required locale string "${keyPath}"`,
      });
      continue;
    }
    for (const placeholder of placeholders) {
      if (value.includes(`{${placeholder}}`)) continue;
      const offset = sourceText.indexOf(JSON.stringify(value).slice(1, -1));
      failures.push({
        rule: '@pivi/pivi-react locale copy parameterizes host terminology',
        file: path.relative(rootDir, file),
        line: offset < 0 ? 1 : sourceText.slice(0, offset).split('\n').length,
        detail: `locale string "${keyPath}" is missing {${placeholder}}`,
      });
    }
    if (/\b(?:keychain|vault|secret\s*storage)\b/i.test(value)) {
      const offset = sourceText.indexOf(JSON.stringify(value).slice(1, -1));
      failures.push({
        rule: '@pivi/pivi-react locale copy parameterizes host terminology',
        file: path.relative(rootDir, file),
        line: offset < 0 ? 1 : sourceText.slice(0, offset).split('\n').length,
        detail: `locale string "${keyPath}" hard-codes workspace or credential terminology`,
      });
    }
  }
}

const piviReactCssFiles = listCssFiles(piviReactStylesDir);
const locallyDefinedCssVariables = new Set(
  piviReactCssFiles.flatMap(file =>
    [...fs.readFileSync(file, 'utf8').matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])),
);
for (const file of piviReactCssFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, comment => '\n'.repeat(
    Math.max(0, comment.split('\n').length - 1),
  ));
  for (const block of sourceWithoutComments.matchAll(/([^{}]+)\{/g)) {
    const selectorText = block[1];
    for (const classMatch of selectorText.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
      const className = classMatch[1];
      if (!isForbiddenHostClassName(className)) continue;
      const offset = (block.index ?? 0) + (classMatch.index ?? 0);
      failures.push({
        rule: '@pivi/pivi-react CSS selectors use product-owned classes',
        file: path.relative(rootDir, file),
        line: sourceWithoutComments.slice(0, offset).split('\n').length,
        detail: `targets forbidden host class ".${className}"`,
      });
    }
    for (const attributeMatch of selectorText.matchAll(
      /\[\s*class\s*[~|^$*]?=\s*["']([^"']+)["']\s*\]/g,
    )) {
      for (const className of attributeMatch[1].split(/\s+/).filter(Boolean)) {
        if (!isForbiddenHostClassName(className)) continue;
        const offset = (block.index ?? 0) + (attributeMatch.index ?? 0);
        failures.push({
          rule: '@pivi/pivi-react CSS selectors use product-owned classes',
          file: path.relative(rootDir, file),
          line: sourceWithoutComments.slice(0, offset).split('\n').length,
          detail: `targets forbidden host class "${className}" through a class attribute selector`,
        });
      }
    }
  }
  for (const match of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const variable = match[1];
    if (variable.startsWith('--pivi-') || locallyDefinedCssVariables.has(variable)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    failures.push({
      rule: '@pivi/pivi-react CSS uses only --pivi-* or locally defined variables',
      file: path.relative(rootDir, file),
      line,
      moduleName: variable,
    });
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
