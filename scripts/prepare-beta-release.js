#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { inc, prerelease, valid } = require('semver');

const repoRoot = path.join(__dirname, '..');
const packagePath = path.join(repoRoot, 'package.json');
const releasePleaseManifestPath = path.join(
  repoRoot,
  '.release-please-manifest.json',
);

const allowedBranches = new Set(['next', 'beta']);

/**
 * @param {string[]} argv
 * @returns {{ base?: string }}
 */
function parseArgs(argv) {
  let base;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --base');
      }
      base = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { base };
}

/**
 * @param {string} branch
 */
function assertAllowedBranch(branch) {
  if (!allowedBranches.has(branch)) {
    throw new Error(
      `prepare-beta-release must run on next or beta, not "${branch}".`,
    );
  }
}

/**
 * @returns {string}
 */
function readCurrentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

/**
 * @param {string} version
 * @returns {string}
 */
function assertValidVersion(version) {
  const normalized = valid(version);
  if (!normalized) {
    throw new Error(`Invalid semver version: ${version}`);
  }
  return normalized;
}

/**
 * @param {string | undefined} base
 * @param {string} currentVersion
 * @param {string} stableVersion
 * @returns {string}
 */
function resolveNextBetaVersion(base, currentVersion, stableVersion) {
  if (prerelease(currentVersion) !== null) {
    const next = inc(currentVersion, 'prerelease', 'beta');
    if (!next) {
      throw new Error(`Could not increment prerelease for ${currentVersion}`);
    }
    return next;
  }

  if (base) {
    const normalizedBase = assertValidVersion(base);
    return `${normalizedBase}-beta.0`;
  }

  if (typeof stableVersion !== 'string' || stableVersion.length === 0) {
    throw new Error('.release-please-manifest.json is missing a root version');
  }

  const next = inc(stableVersion, 'preminor', 'beta');
  if (!next) {
    throw new Error(
      `Could not compute the first beta version from stable ${stableVersion}`,
    );
  }
  return next;
}

/**
 * @param {{ base?: string; branch: string; currentVersion: string; stableVersion: string }} input
 * @returns {string}
 */
function prepareBetaVersion({ base, branch, currentVersion, stableVersion }) {
  assertAllowedBranch(branch);
  return resolveNextBetaVersion(base, currentVersion, stableVersion);
}

function main() {
  const { base } = parseArgs(process.argv);
  const branch = readCurrentBranch();
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const releasePleaseManifest = JSON.parse(
    fs.readFileSync(releasePleaseManifestPath, 'utf8'),
  );
  const nextVersion = prepareBetaVersion({
    base,
    branch,
    currentVersion: packageJson.version,
    stableVersion: releasePleaseManifest['.'],
  });

  packageJson.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(`Prepared beta version ${nextVersion} in package.json`);
  console.log('');
  console.log('Next steps:');
  console.log('  git add package.json');
  console.log(`  git commit -m "chore(release): prepare ${nextVersion}"`);
  console.log(`  git tag -a ${nextVersion} -m "${nextVersion}"`);
  console.log(`  git push origin ${branch} && git push origin ${nextVersion}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  assertAllowedBranch,
  parseArgs,
  prepareBetaVersion,
  resolveNextBetaVersion,
};
