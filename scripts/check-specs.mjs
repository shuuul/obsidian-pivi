import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const specsDir = path.join(rootDir, 'specs');
const archiveDir = path.join(specsDir, 'archive');
const readmePath = path.join(specsDir, 'README.md');
const templatePath = path.join(specsDir, '000-template.md');
const specFilePattern = /^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const indexedSpecPattern = /^(archive\/)?(\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const requiredMetadata = ['id', 'title', 'status', 'created', 'updated', 'coordinator'];
const requiredHeadings = [
  '## Context',
  '## Goal and success criteria',
  '## Scope and non-goals',
  '## Decisions',
  '## Workstreams',
  '## Verification',
  '## Documentation sync',
  '## Progress and handoff',
  '## Completion summary',
];
const failures = [];

function fail(message) {
  failures.push(message);
}

function relative(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`${relative(filePath)} is missing`);
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function parseScalar(value, filePath, lineNumber) {
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith(value[0])) {
      fail(`${relative(filePath)}:${lineNumber} has an unterminated quoted scalar`);
      return value;
    }
    return value.slice(1, -1);
  }
  if (/^(?:\[|]|\{|\||}|>|[&*!]|-\s)/.test(value)) {
    fail(`${relative(filePath)}:${lineNumber} must use a flat scalar, not structured YAML`);
  }
  return value;
}

function parseFrontmatter(contents, filePath) {
  if (!contents.startsWith('---\n')) {
    fail(`${relative(filePath)} is missing opening frontmatter delimiter`);
    return {};
  }

  const closingDelimiter = contents.indexOf('\n---\n', 4);
  if (closingDelimiter === -1) {
    fail(`${relative(filePath)} is missing closing frontmatter delimiter`);
    return {};
  }

  const metadata = {};
  const lines = contents.slice(4, closingDelimiter).split('\n');
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(.*?)\s*$/);
    if (!match || match[2] === '') {
      fail(`${relative(filePath)}:${index + 2} must use flat non-empty key: value frontmatter`);
      continue;
    }
    if (Object.hasOwn(metadata, match[1])) {
      fail(`${relative(filePath)} has duplicate frontmatter key ${match[1]}`);
      continue;
    }
    metadata[match[1]] = parseScalar(match[2], filePath, index + 2);
  }
  return metadata;
}

function validateStructure(contents, filePath) {
  const metadata = parseFrontmatter(contents, filePath);
  for (const key of requiredMetadata) {
    if (!metadata[key]) fail(`${relative(filePath)} is missing frontmatter key ${key}`);
  }
  const headingCounts = new Map();
  let fence = null;
  for (const line of contents.split('\n')) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1] : (fence === fenceMatch[1] ? null : fence);
      continue;
    }
    if (fence !== null) continue;
    const headingMatch = line.match(/^(## .+?)\s*$/);
    if (headingMatch) {
      headingCounts.set(headingMatch[1], (headingCounts.get(headingMatch[1]) ?? 0) + 1);
    }
  }
  for (const heading of requiredHeadings) {
    const count = headingCounts.get(heading) ?? 0;
    if (count !== 1) {
      fail(`${relative(filePath)} must contain ${heading} exactly once`);
    }
  }
  return metadata;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return timestamp;
}

function listMarkdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function validateSpec(filePath, location) {
  const filename = path.basename(filePath);
  const filenameMatch = filename.match(specFilePattern);
  if (!filenameMatch || filenameMatch[1] === '000') {
    fail(`${relative(filePath)} must be named NNN-kebab-case.md with an ID from 001`);
    return null;
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const metadata = validateStructure(contents, filePath);
  const id = filenameMatch[1];
  if (metadata.id !== id) {
    fail(`${relative(filePath)} frontmatter id must match filename ID ${id}`);
  }
  const created = parseDate(metadata.created ?? '');
  const updated = parseDate(metadata.updated ?? '');
  if (created === null) fail(`${relative(filePath)} created must be a real YYYY-MM-DD date`);
  if (updated === null) fail(`${relative(filePath)} updated must be a real YYYY-MM-DD date`);
  if (created !== null && updated !== null && updated < created) {
    fail(`${relative(filePath)} updated must not be earlier than created`);
  }

  const allowedStatuses = location === 'active' ? ['Draft', 'Active'] : ['Completed'];
  if (!allowedStatuses.includes(metadata.status)) {
    fail(`${relative(filePath)} status must be ${allowedStatuses.join(' or ')} in ${location}`);
  }

  return { filePath, id, numericId: Number(id), location };
}

function section(contents, heading) {
  const startMarker = `${heading}\n`;
  const start = contents.indexOf(startMarker);
  if (start === -1) {
    fail(`${relative(readmePath)} is missing ${heading}`);
    return '';
  }
  const contentStart = start + startMarker.length;
  const nextHeading = contents.indexOf('\n## ', contentStart);
  return contents.slice(contentStart, nextHeading === -1 ? contents.length : nextHeading);
}

function specLinks(contents) {
  const links = [];
  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (indexedSpecPattern.test(match[1])) links.push(match[1]);
  }
  return links;
}

function validateIndex(readme, specs) {
  const activeLinks = specLinks(section(readme, '## Active specs'));
  const archivedLinks = specLinks(section(readme, '## Archived specs'));
  const allLinks = [...activeLinks, ...archivedLinks];

  if ((readme.match(/\(000-template\.md\)/g) ?? []).length !== 1) {
    fail(`${relative(readmePath)} must link 000-template.md exactly once`);
  }

  for (const spec of specs) {
    const expectedLink = spec.location === 'active'
      ? path.basename(spec.filePath)
      : `archive/${path.basename(spec.filePath)}`;
    const expectedLinks = spec.location === 'active' ? activeLinks : archivedLinks;
    const wrongLinks = spec.location === 'active' ? archivedLinks : activeLinks;
    const occurrences = expectedLinks.filter((link) => link === expectedLink).length;
    if (occurrences !== 1) {
      fail(`${relative(readmePath)} must link ${expectedLink} exactly once in the matching index`);
    }
    if (wrongLinks.includes(expectedLink)) {
      fail(`${relative(readmePath)} links ${expectedLink} in the wrong index`);
    }
  }

  for (const link of allLinks) {
    if (!fs.existsSync(path.join(specsDir, link))) {
      fail(`${relative(readmePath)} links missing spec ${link}`);
    }
  }

  for (const [name, links] of [['Active specs', activeLinks], ['Archived specs', archivedLinks]]) {
    const ids = links.map((link) => Number(link.match(indexedSpecPattern)[2]));
    for (let index = 1; index < ids.length; index += 1) {
      if (ids[index] <= ids[index - 1]) {
        fail(`${relative(readmePath)} ${name} links must be in ascending ID order`);
        break;
      }
    }
  }
}

if (!fs.existsSync(specsDir)) {
  fail('specs/ is missing');
} else {
  const template = readRequiredFile(templatePath);
  if (template !== null) validateStructure(template, templatePath);
  const readme = readRequiredFile(readmePath);

  const activeFiles = listMarkdownFiles(specsDir)
    .filter((filePath) => !['README.md', '000-template.md'].includes(path.basename(filePath)));
  const archivedFiles = listMarkdownFiles(archiveDir);
  const specs = [
    ...activeFiles.map((filePath) => validateSpec(filePath, 'active')),
    ...archivedFiles.map((filePath) => validateSpec(filePath, 'archive')),
  ].filter(Boolean);

  const specsById = new Map();
  for (const spec of specs) {
    const prior = specsById.get(spec.id);
    if (prior) {
      fail(`spec ID ${spec.id} is duplicated by ${relative(prior.filePath)} and ${relative(spec.filePath)}`);
    } else {
      specsById.set(spec.id, spec);
    }
  }

  const sortedIds = [...new Set(specs.map((spec) => spec.numericId))].sort((left, right) => left - right);
  for (const [index, id] of sortedIds.entries()) {
    if (id !== index + 1) {
      fail(`spec IDs must be continuous from 001; expected ${String(index + 1).padStart(3, '0')} but found ${String(id).padStart(3, '0')}`);
      break;
    }
  }

  if (readme !== null) validateIndex(readme, specs);
}

if (failures.length > 0) {
  console.error('Specs check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Specs check passed.');
