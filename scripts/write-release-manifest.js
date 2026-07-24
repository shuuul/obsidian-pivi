#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { buildReleaseManifest } = require('./versionMetadata');

const repoRoot = path.join(__dirname, '..');
const packagePath = path.join(repoRoot, 'package.json');
const manifestPath = path.join(repoRoot, 'manifest.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const releaseManifest = buildReleaseManifest({
  manifestJson,
  packageVersion: packageJson.version,
});

fs.writeFileSync(
  manifestPath,
  JSON.stringify(releaseManifest, null, 2) + '\n',
);

console.log(`Prepared release manifest.json at ${packageJson.version}`);
