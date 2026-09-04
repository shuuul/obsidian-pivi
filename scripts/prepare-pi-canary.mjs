import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import semver from 'semver';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const piPackages = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function registryVersions(packageName) {
  const output = execFileSync('npm', ['view', packageName, 'versions', '--json'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function selectNextSynchronizedVersion(current, versionLists) {
  const common = versionLists.slice(1).reduce(
    (versions, list) => versions.filter(version => list.includes(version)),
    [...versionLists[0]],
  );
  return common
    .filter(version => semver.valid(version) && semver.prerelease(version) === null && semver.gt(version, current))
    .sort(semver.rcompare)[0] ?? '';
}

function resolveTarget() {
  const rootPackage = readJson('package.json');
  const current = rootPackage.dependencies[piPackages[0]];
  const target = selectNextSynchronizedVersion(current, piPackages.map(registryVersions));
  process.stdout.write(target);
}

function applyTarget(target) {
  if (!semver.valid(target)) throw new Error(`Invalid Pi canary target: ${target}`);
  const rootPackage = readJson('package.json');
  const enginePackage = readJson('packages/engine-pi/package.json');
  const current = rootPackage.dependencies[piPackages[0]];
  if (!semver.gt(target, current)) throw new Error(`Pi canary target ${target} must be newer than ${current}`);
  for (const packageName of piPackages) {
    rootPackage.dependencies[packageName] = target;
    enginePackage.dependencies[packageName] = target;
  }
  writeJson('package.json', rootPackage);
  writeJson('packages/engine-pi/package.json', enginePackage);

  const shimPath = path.join(rootDir, 'packages/engine-pi/src/shims/piCodingAgentConfig.ts');
  const shim = fs.readFileSync(shimPath, 'utf8').replace(
    /export const VERSION = '[^']+';/,
    `export const VERSION = '${target}';`,
  );
  fs.writeFileSync(shimPath, shim);

  const manifest = readJson('packages/engine-pi/compatibility-manifest.json');
  for (const entry of manifest.entries) entry.upstreamVersion = target;
  writeJson('packages/engine-pi/compatibility-manifest.json', manifest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, value] = process.argv.slice(2);
  if (command === '--resolve') resolveTarget();
  else if (command === '--apply' && value) applyTarget(value);
  else throw new Error('Usage: prepare-pi-canary.mjs --resolve | --apply <version>');
}
