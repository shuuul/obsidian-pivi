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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
