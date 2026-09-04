#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'docs', 'capabilities.json');
const canonicalDocs = [
  'README.md',
  'SECURITY.md',
  'docs/07-tools-skills-mcp-and-integrations.md',
];
const excludedDirectories = new Set([
  '.git',
  '.worktrees',
  'assets',
  'build',
  'coverage',
  'node_modules',
  'specs',
]);
const excludedFiles = new Set(['CHANGELOG.md']);
const transportLabels = new Map([
  ['streamable-http', 'Streamable HTTP'],
  ['sse', 'SSE'],
]);
const removedCapabilityPatterns = new Map([
  ['stdio-mcp', [
    /\bStdio processes? start\b/i,
    /\bfake stdio (?:listener|server)\b/i,
    /\b(?:supports?|enables?|configures?|connects? to|runs?) (?:local )?Stdio MCP\b/i,
    /\bStdio MCP (?:is|remains) (?:supported|available|enabled)\b/i,
  ]],
  ['mcp-json-import', [
    /\b(?:import|paste|load) (?:an? )?MCP JSON\b/i,
    /\bMCP JSON import (?:is|remains) (?:supported|available|enabled)\b/i,
  ]],
  ['vim-mappings', [
    /\b(?:supports?|enables?|configures?) Vim (?:key )?mappings\b/i,
    /\bVim (?:key )?mappings? (?:are|remain) (?:supported|available|enabled)\b/i,
  ]],
]);

function fail(message) {
  console.error(`Docs contract check failed:\n\n- ${message}`);
  process.exit(1);
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    fail('docs/capabilities.json is missing');
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`docs/capabilities.json is invalid JSON: ${error.message}`);
  }
}

function validateManifest(manifest) {
  const errors = [];
  if (manifest.contractVersion !== 1) {
    errors.push('contractVersion must be 1');
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.mcp?.remoteOnlySince ?? '')) {
    errors.push('mcp.remoteOnlySince must be a SemVer release');
  }
  const transports = manifest.mcp?.supportedTransports;
  if (!Array.isArray(transports) || transports.length === 0) {
    errors.push('mcp.supportedTransports must be a non-empty array');
  } else {
    for (const transport of transports) {
      if (!transportLabels.has(transport)) {
        errors.push(`mcp.supportedTransports contains unknown transport ${JSON.stringify(transport)}`);
      }
    }
  }
  const removed = manifest.removedCapabilities;
  if (!Array.isArray(removed) || removed.length === 0) {
    errors.push('removedCapabilities must be a non-empty array');
  } else {
    const ids = new Set();
    for (const entry of removed) {
      if (!removedCapabilityPatterns.has(entry?.id)) {
        errors.push(`removedCapabilities contains unknown id ${JSON.stringify(entry?.id)}`);
      } else if (ids.has(entry.id)) {
        errors.push(`removedCapabilities contains duplicate id ${JSON.stringify(entry.id)}`);
      }
      ids.add(entry?.id);
      if (!/^\d+\.\d+\.\d+$/.test(entry?.removedIn ?? '')) {
        errors.push(`removed capability ${JSON.stringify(entry?.id)} has invalid removedIn`);
      }
    }
  }
  return errors;
}

function canonicalMcpStatement(manifest) {
  const labels = manifest.mcp.supportedTransports.map((transport) => transportLabels.get(transport));
  const transportList = labels.length === 2
    ? `${labels[0]} or ${labels[1]}`
    : labels.join(', ');
  return `Pivi supports only remote MCP servers over ${transportList}. Stdio MCP is not supported; this remote-only contract was introduced in v${manifest.mcp.remoteOnlySince}.`;
}

function listActiveMarkdown(directory = rootDir) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') && directory === rootDir && entry.name !== '.github') {
      return [];
    }
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
      return [];
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listActiveMarkdown(fullPath);
    if (!entry.isFile() || !entry.name.endsWith('.md')) return [];
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
    return excludedFiles.has(relativePath) ? [] : [fullPath];
  });
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

const manifest = readManifest();
const failures = validateManifest(manifest);

if (failures.length === 0) {
  const canonicalStatement = canonicalMcpStatement(manifest);
  for (const relativePath of canonicalDocs) {
    const filePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(filePath)) {
      failures.push(`${relativePath} is missing`);
      continue;
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    const count = contents.split(canonicalStatement).length - 1;
    if (count !== 1) {
      failures.push(
        `${relativePath} must contain the canonical MCP transport statement exactly once`,
      );
    }
  }

  for (const filePath of listActiveMarkdown()) {
    const contents = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
    for (const entry of manifest.removedCapabilities) {
      for (const pattern of removedCapabilityPatterns.get(entry.id)) {
        const match = pattern.exec(contents);
        if (match) {
          failures.push(
            `${relativePath}:${lineNumberAt(contents, match.index)} presents removed capability ${entry.id} as current`,
          );
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Docs contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Docs capability contracts passed.');
