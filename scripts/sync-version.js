#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const versionsPath = path.join(__dirname, '..', 'versions.json');
const readmePath = path.join(__dirname, '..', 'README.md');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versionsJson = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const readme = fs.readFileSync(readmePath, 'utf8');

manifestJson.version = packageJson.version;
versionsJson[packageJson.version] = manifestJson.minAppVersion;

const readmeVersionBadgePattern =
  /(https:\/\/img\.shields\.io\/static\/v1\?label=version&message=)([^&]+)(&color=blue)/;

if (!readmeVersionBadgePattern.test(readme)) {
  throw new Error('README version badge not found');
}

const updatedReadme = readme.replace(
  readmeVersionBadgePattern,
  `$1${packageJson.version}$3`,
);

fs.writeFileSync(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n');
fs.writeFileSync(versionsPath, JSON.stringify(versionsJson, null, 2) + '\n');
fs.writeFileSync(readmePath, updatedReadme);

console.log(`Synced plugin version metadata to ${packageJson.version}`);
