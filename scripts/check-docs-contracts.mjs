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
]);
const excludedFiles = new Set(['CHANGELOG.md']);
const excludedSourcePrefixes = ['specs/archive/'];
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
    return excludedFiles.has(relativePath)
      || excludedSourcePrefixes.some(prefix => relativePath.startsWith(prefix))
      ? []
      : [fullPath];
  });
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split('\n').length;
}

function withoutFencedCode(contents) {
  const lines = contents.split('\n');
  let fence = null;
  return lines.map((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && match) {
      fence = { character: match[1][0], length: match[1].length };
      return '';
    }
    if (
      fence
      && new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)
    ) {
      fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

function withoutMarkdownCode(contents) {
  return withoutFencedCode(contents).replace(/(`+)([^`\n]*?)\1/g, match => ' '.repeat(match.length));
}

function markdownHeadingAnchors(contents) {
  const anchors = new Set();
  const duplicateCounts = new Map();
  for (const line of withoutFencedCode(contents).split('\n')) {
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = heading[1]
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .trim()
      .toLowerCase()
      .replace(/\s/g, '-');
    const duplicate = duplicateCounts.get(base) ?? 0;
    duplicateCounts.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }
  for (const match of contents.matchAll(/<(?:a|[A-Za-z][\w:-]*)\s+[^>]*\bid=["']([^"']+)["'][^>]*>/g)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function decodeLinkPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function validateMarkdownLinks(filePath, contents) {
  const relativeSource = path.relative(rootDir, filePath).split(path.sep).join('/');
  const searchable = withoutMarkdownCode(contents);
  const references = new Map();
  for (const match of searchable.matchAll(
    /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>\n]+)>|([^\s]+))(?:\s+.*)?$/gm,
  )) {
    references.set(match[1].trim().toLowerCase(), match[2] ?? match[3]);
  }

  const links = [];
  for (const match of searchable.matchAll(
    /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g,
  )) {
    links.push({ destination: match[1] ?? match[2], index: match.index });
  }
  for (const match of searchable.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const key = (match[2] || match[1]).trim().toLowerCase();
    const destination = references.get(key);
    if (destination) links.push({ destination, index: match.index });
  }

  const linkFailures = [];
  for (const { destination, index } of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)) continue;
    const hashIndex = destination.indexOf('#');
    const rawPathAndQuery = hashIndex < 0 ? destination : destination.slice(0, hashIndex);
    const rawFragment = hashIndex < 0 ? '' : destination.slice(hashIndex + 1);
    const rawPath = rawPathAndQuery.split('?')[0];
    const decodedPath = decodeLinkPart(rawPath);
    const decodedFragment = decodeLinkPart(rawFragment);
    const line = lineNumberAt(searchable, index);
    if (decodedPath === null || decodedFragment === null) {
      linkFailures.push(`${relativeSource}:${line} contains invalid URL encoding in link ${JSON.stringify(destination)}`);
      continue;
    }
    const target = decodedPath.length === 0
      ? filePath
      : decodedPath.startsWith('/')
        ? path.resolve(rootDir, decodedPath.slice(1))
        : path.resolve(path.dirname(filePath), decodedPath);
    const relativeTarget = path.relative(rootDir, target);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      linkFailures.push(`${relativeSource}:${line} link escapes the repository: ${JSON.stringify(destination)}`);
      continue;
    }
    if (!fs.existsSync(target)) {
      linkFailures.push(`${relativeSource}:${line} link target does not exist: ${JSON.stringify(destination)}`);
      continue;
    }
    if (
      decodedFragment
      && fs.statSync(target).isFile()
      && path.extname(target).toLowerCase() === '.md'
      && !markdownHeadingAnchors(fs.readFileSync(target, 'utf8')).has(decodedFragment.toLowerCase())
    ) {
      linkFailures.push(`${relativeSource}:${line} Markdown fragment does not exist: ${JSON.stringify(destination)}`);
    }
  }
  return linkFailures;
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
    const searchable = withoutMarkdownCode(contents);
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join('/');
    for (const entry of manifest.removedCapabilities) {
      for (const pattern of removedCapabilityPatterns.get(entry.id)) {
        const match = pattern.exec(searchable);
        if (match) {
          failures.push(
            `${relativePath}:${lineNumberAt(searchable, match.index)} presents removed capability ${entry.id} as current`,
          );
        }
      }
    }
    failures.push(...validateMarkdownLinks(filePath, contents));
  }
}

if (failures.length > 0) {
  console.error('Docs contract check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Docs contracts passed.');
