/**
 * Fail when declared or locked Pi package versions are ranged or desynchronized.
 *
 * The three @earendil-works/pi-* packages must share one exact version across
 * root package.json, packages/pivi-agent-core/package.json, package-lock.json,
 * and the engine shim VERSION constant.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PI_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isExactVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function collectErrors() {
  const errors = [];
  const rootPackage = readJson(path.join(rootDir, 'package.json'));
  const corePackage = readJson(path.join(rootDir, 'packages', 'pivi-agent-core', 'package.json'));
  const lockfile = readJson(path.join(rootDir, 'package-lock.json'));
  const shimSource = fs.readFileSync(
    path.join(
      rootDir,
      'packages',
      'pivi-agent-core',
      'src',
      'engine',
      'pi',
      'shims',
      'piCodingAgentConfig.ts',
    ),
    'utf8',
  );
  const shimMatch = shimSource.match(/export const VERSION = '([^']+)';/);
  if (!shimMatch) {
    errors.push('piCodingAgentConfig.ts is missing export const VERSION');
    return errors;
  }
  const shimVersion = shimMatch[1];

  const rootVersions = [];
  const coreVersions = [];
  const rootLockDeps = lockfile.packages?.['']?.dependencies ?? {};
  const workspaceLockDeps =
    lockfile.packages?.['packages/pivi-agent-core']?.dependencies ?? {};

  for (const name of PI_PACKAGES) {
    const rootVersion = rootPackage.dependencies?.[name];
    const coreVersion = corePackage.dependencies?.[name];
    if (!isExactVersion(rootVersion)) {
      errors.push(
        `Root package.json must pin ${name} to an exact version; found ${JSON.stringify(rootVersion)}`,
      );
    } else {
      rootVersions.push(rootVersion);
    }
    if (!isExactVersion(coreVersion)) {
      errors.push(
        `packages/pivi-agent-core/package.json must pin ${name} to an exact version; found ${JSON.stringify(coreVersion)}`,
      );
    } else {
      coreVersions.push(coreVersion);
    }

    const declaredRootLock = rootLockDeps[name];
    if (!isExactVersion(declaredRootLock)) {
      errors.push(
        `package-lock.json root dependency for ${name} must be exact; found ${JSON.stringify(declaredRootLock)}`,
      );
    } else if (isExactVersion(rootVersion) && declaredRootLock !== rootVersion) {
      errors.push(
        `package-lock.json root dependency for ${name} is ${declaredRootLock} but package.json declares ${rootVersion}`,
      );
    }

    const declaredWorkspaceLock = workspaceLockDeps[name];
    if (!isExactVersion(declaredWorkspaceLock)) {
      errors.push(
        `package-lock.json workspace dependency for ${name} must be exact; found ${JSON.stringify(declaredWorkspaceLock)}`,
      );
    } else if (isExactVersion(coreVersion) && declaredWorkspaceLock !== coreVersion) {
      errors.push(
        `package-lock.json workspace dependency for ${name} is ${declaredWorkspaceLock} but package.json declares ${coreVersion}`,
      );
    }

    const lockNode = lockfile.packages?.[`node_modules/${name}`];
    const lockedVersion = lockNode?.version;
    if (!isExactVersion(lockedVersion)) {
      errors.push(
        `package-lock.json must resolve ${name} to an exact version; found ${JSON.stringify(lockedVersion)}`,
      );
    } else if (isExactVersion(rootVersion) && lockedVersion !== rootVersion) {
      errors.push(
        `package-lock.json resolves ${name}@${lockedVersion} but root declares ${rootVersion}`,
      );
    }
  }

  const uniqueRoot = [...new Set(rootVersions)];
  const uniqueCore = [...new Set(coreVersions)];
  if (uniqueRoot.length > 1) {
    errors.push(`Root Pi package versions must match exactly; found ${uniqueRoot.join(', ')}`);
  }
  if (uniqueCore.length > 1) {
    errors.push(
      `pivi-agent-core Pi package versions must match exactly; found ${uniqueCore.join(', ')}`,
    );
  }
  const expected = uniqueRoot[0] ?? uniqueCore[0];
  if (expected) {
    if (uniqueCore.some((version) => version !== expected)) {
      errors.push(
        `Root and pivi-agent-core Pi pins must match; root=${expected} core=${uniqueCore.join(',')}`,
      );
    }
    if (shimVersion !== expected) {
      errors.push(
        `piCodingAgentConfig VERSION (${shimVersion}) must equal the exact Pi pin (${expected})`,
      );
    }
  }

  return errors;
}

const errors = collectErrors();
if (errors.length > 0) {
  console.error('Pi package pin check failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Pi package pins are exact and synchronized.');
