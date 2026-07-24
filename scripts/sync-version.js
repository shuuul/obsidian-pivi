#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const {
  buildStableVersionMetadata,
  isPrereleaseVersion,
} = require('./versionMetadata');

const packagePath = path.join(__dirname, '..', 'package.json');
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const versionsPath = path.join(__dirname, '..', 'versions.json');
const readmePath = path.join(__dirname, '..', 'README.md');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

if (isPrereleaseVersion(packageJson.version)) {
  console.log(
    `Skipping stable metadata sync for prerelease ${packageJson.version}; root manifest.json stays on the community-plugin channel.`,
  );
  process.exit(0);
}

const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versionsJson = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const readme = fs.readFileSync(readmePath, 'utf8');

const synced = buildStableVersionMetadata({
  packageJson,
  manifestJson,
  versionsJson,
  readme,
});

fs.writeFileSync(
  manifestPath,
  JSON.stringify(synced.manifestJson, null, 2) + '\n',
);
fs.writeFileSync(
  versionsPath,
  JSON.stringify(synced.versionsJson, null, 2) + '\n',
);
fs.writeFileSync(readmePath, synced.readme);

console.log(`Synced plugin version metadata to ${packageJson.version}`);
