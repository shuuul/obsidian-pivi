import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.indexOf('--root');
const rootDir = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1] ?? '') : defaultRoot;
const manifestPath = 'packages/engine-pi/compatibility-manifest.json';
const expectedPackages = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-mcp',
];
const knownCompatibilityPaths = [
  'build/plugins/shim-pi-ai.mjs',
  'build/plugins/shim-pi-coding-agent-config.mjs',
  'build/plugins/dedupe-pi-dependencies.mjs',
  'build/plugins/shim-signal-exit.mjs',
  'build/postprocess/rewrite-node-imports.mjs',
  'packages/engine-pi/src/shims/piAiCompat.ts',
  'packages/engine-pi/src/shims/piAiEnvApiKeys.ts',
  'packages/engine-pi/src/shims/piCodingAgentConfig.ts',
  'packages/engine-pi/src/shims/signalExit.cjs',
  'packages/engine-pi/src/session/piSessionManagerPrivateAdapter.ts',
  'packages/engine-pi/src/models/piAiModels.ts',
  'packages/obsidian-host/src/bundledFetch.ts',
];

// Source roots whose Pi SDK import specifiers must resolve through the upstream
// export map or be manifested as a deliberate deep import.
const sourceRoots = ['src', 'packages'];
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const importSpecifierPattern = /(?:\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*|\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(@earendil-works\/pi-[^'"]+)\2/g;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function listSourceFiles(relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const dirent of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (dirent.name === 'node_modules' || dirent.name.startsWith('.')) continue;
    const relativePath = path.posix.join(relativeDir, dirent.name);
    if (dirent.isDirectory()) files.push(...listSourceFiles(relativePath));
    else if (sourceExtensions.has(path.extname(dirent.name))) files.push(relativePath);
  }
  return files;
}

function splitSpecifier(specifier) {
  const match = /^(@earendil-works\/[^/]+)(?:\/(.*))?$/.exec(specifier);
  return match ? { packageName: match[1], subpath: match[2] ? `./${match[2]}` : '.' } : undefined;
}

function isExportedSubpath(exportsField, subpath) {
  if (exportsField === undefined) return true;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) return subpath === '.';
  const keys = Object.keys(exportsField);
  if (!keys.some(key => key.startsWith('.'))) return subpath === '.';
  return keys.some((key) => {
    if (key === subpath) return true;
    const star = key.indexOf('*');
    if (star < 0) return false;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    return subpath.length >= prefix.length + suffix.length
      && subpath.startsWith(prefix)
      && subpath.endsWith(suffix);
  });
}

/** Collects Pi SDK import specifiers that bypass the installed package export map. */
function collectDeepImports() {
  const exportMaps = new Map();
  const deepImports = [];
  for (const file of sourceRoots.flatMap(listSourceFiles)) {
    const source = fs.readFileSync(path.join(rootDir, file), 'utf8');
    for (const match of source.matchAll(importSpecifierPattern)) {
      const specifier = match[3];
      const namedImports = (match[1] ?? '')
        .split(',')
        .map(part => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
        .filter(Boolean);
      const parts = splitSpecifier(specifier);
      if (!parts || !expectedPackages.includes(parts.packageName)) continue;
      if (!exportMaps.has(parts.packageName)) {
        const manifestFile = path.join(rootDir, 'node_modules', parts.packageName, 'package.json');
        exportMaps.set(
          parts.packageName,
          fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).exports : null,
        );
      }
      const exportsField = exportMaps.get(parts.packageName);
      // Without an installed package the export map is unknown; treat only
      // explicit dist/ paths as deep so fixture roots stay deterministic.
      const deep = exportsField === null
        ? parts.subpath.startsWith('./dist/')
        : !isExportedSubpath(exportsField, parts.subpath);
      if (deep) deepImports.push({ file, specifier, namedImports, installed: exportsField !== null });
    }
  }
  return deepImports;
}

/**
 * Deep imports bypass the export map, so an upstream file move or rename is
 * only otherwise noticed by the production build. Verify the installed target
 * and its declared named exports here instead.
 */
function deepImportTargetErrors(specifier, namedImports) {
  const target = path.join(rootDir, 'node_modules', specifier);
  if (!fs.existsSync(target)) return [`Pi deep import target is missing from the installed package: ${specifier}`];
  const declaration = target.replace(/\.[cm]?js$/, '.d.ts');
  if (namedImports.length === 0 || !fs.existsSync(declaration)) return [];
  const declarationSource = fs.readFileSync(declaration, 'utf8');
  return namedImports
    .filter(name => !new RegExp(`\\bexport\\b[^;]*\\b${name}\\b`).test(declarationSource))
    .map(name => `Pi deep import ${specifier} no longer declares export ${name}`);
}

function collectErrors() {
  const errors = [];
  const rootPackage = readJson('package.json');
  const manifest = readJson(manifestPath);
  const pinnedVersion = rootPackage.dependencies?.[expectedPackages[0]];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (JSON.stringify(manifest.upstreamPackages) !== JSON.stringify(expectedPackages)) {
    errors.push(`upstreamPackages must list exactly: ${expectedPackages.join(', ')}`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    errors.push('entries must be a non-empty array');
    return errors;
  }

  const ids = new Set();
  const coveredPaths = new Set();
  const manifestedDeepImports = new Map();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = nonEmptyString(entry?.id) ? entry.id : `entry ${index + 1}`;
    if (!nonEmptyString(entry?.id)) errors.push(`${label}: id must be non-empty`);
    else if (ids.has(entry.id)) errors.push(`${label}: duplicate id`);
    else ids.add(entry.id);
    for (const field of ['reason', 'removalCondition']) {
      if (!nonEmptyString(entry?.[field])) errors.push(`${label}: ${field} must be non-empty`);
    }
    if (entry?.upstreamVersion !== pinnedVersion) {
      errors.push(`${label}: upstreamVersion ${JSON.stringify(entry?.upstreamVersion)} must equal the exact Pi pin ${JSON.stringify(pinnedVersion)}`);
    }
    if (!Number.isInteger(entry?.trackingIssue) || entry.trackingIssue <= 0) {
      errors.push(`${label}: trackingIssue must be a positive issue number`);
    }
    for (const field of ['implementationPaths', 'verificationTests']) {
      const paths = entry?.[field];
      if (!Array.isArray(paths) || paths.length === 0) {
        errors.push(`${label}: ${field} must be a non-empty array`);
        continue;
      }
      for (const relativePath of paths) {
        if (!nonEmptyString(relativePath) || path.isAbsolute(relativePath) || relativePath.includes('..')) {
          errors.push(`${label}: invalid ${field} entry ${JSON.stringify(relativePath)}`);
          continue;
        }
        if (!fs.existsSync(path.join(rootDir, relativePath))) {
          errors.push(`${label}: missing ${field} path ${relativePath}`);
        }
        if (field === 'implementationPaths') coveredPaths.add(relativePath);
        if (field === 'verificationTests' && !relativePath.startsWith('tests/')) {
          errors.push(`${label}: verification test must be under tests/: ${relativePath}`);
        }
      }
    }
    if (entry?.deepImports !== undefined) {
      if (!Array.isArray(entry.deepImports) || entry.deepImports.length === 0) {
        errors.push(`${label}: deepImports must be a non-empty array when present`);
      } else {
        for (const specifier of entry.deepImports) {
          if (!nonEmptyString(specifier) || !splitSpecifier(specifier)) {
            errors.push(`${label}: invalid deepImports entry ${JSON.stringify(specifier)}`);
          } else if (manifestedDeepImports.has(specifier)) {
            errors.push(`${label}: deep import ${specifier} is already manifested by ${manifestedDeepImports.get(specifier).id}`);
          } else {
            manifestedDeepImports.set(specifier, entry);
          }
        }
      }
    }
  }
  const usedDeepImports = new Set();
  for (const { file, specifier, namedImports, installed } of collectDeepImports()) {
    usedDeepImports.add(specifier);
    const entry = manifestedDeepImports.get(specifier);
    if (!entry) {
      errors.push(`Unmanifested Pi deep import outside the upstream export map: ${specifier} (${file})`);
    } else if (!entry.implementationPaths.includes(file)) {
      errors.push(`${entry.id}: importing file ${file} must be listed in implementationPaths for ${specifier}`);
    }
    if (installed) errors.push(...deepImportTargetErrors(specifier, namedImports));
  }
  for (const [specifier, entry] of manifestedDeepImports) {
    if (!usedDeepImports.has(specifier)) {
      errors.push(`${entry.id}: manifested deep import ${specifier} is no longer imported; remove it`);
    }
  }
  for (const relativePath of knownCompatibilityPaths) {
    if (!coveredPaths.has(relativePath)) errors.push(`Known compatibility path is not manifested: ${relativePath}`);
  }
  return errors;
}

let errors;
try {
  errors = collectErrors();
} catch (error) {
  errors = [error instanceof Error ? error.message : String(error)];
}
if (errors.length > 0) {
  console.error('Pi compatibility manifest check failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Pi compatibility manifest is complete and aligned with the exact pin.');
