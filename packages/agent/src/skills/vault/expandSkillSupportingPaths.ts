import * as fs from 'node:fs';
import * as path from 'node:path';

const FILE_NAME_PATTERN =
  /^[A-Za-z0-9._-]+\.(md|markdown|py|ts|tsx|js|jsx|cjs|mjs|json|css|txt|yaml|yml|html|htm|sh|toml|xml|svg|png|jpg|jpeg|gif|webp)$/i;
const MISSING_NOTE = ' (not in this skill; do not read)';

export interface SkillRootEntry {
  name: string;
  kind: 'file' | 'folder';
  path: string;
}

export interface ExpandedSkillBody {
  body: string;
  presentPaths: string[];
  missingPaths: string[];
  rootEntries: SkillRootEntry[];
}

function isAbsoluteFsPath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function isInsideDirectory(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedCandidate.startsWith(prefix);
}

function looksLikeRelativeFsPath(value: string): boolean {
  if (!value || /\s/.test(value) || /[<>|*?]/.test(value)) {
    return false;
  }
  if (isAbsoluteFsPath(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return false;
  }
  if (value.startsWith('@') || value.startsWith('#') || value.startsWith('mailto:')) {
    return false;
  }
  const trimmed = value.replace(/[\\/]+$/, '');
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return true;
  }
  return FILE_NAME_PATTERN.test(trimmed);
}

function pathExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function listSkillRoot(absoluteBaseDir: string): SkillRootEntry[] {
  try {
    return fs.readdirSync(absoluteBaseDir, { withFileTypes: true })
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'folder' as const : 'file' as const,
        path: path.join(absoluteBaseDir, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  } catch {
    return [];
  }
}

function classifyRelativePath(
  raw: string,
  absoluteBaseDir: string,
): { kind: 'present'; absolutePath: string } | { kind: 'missing'; relativePath: string } | { kind: 'skip' } {
  const candidate = raw.trim();
  if (!looksLikeRelativeFsPath(candidate)) {
    return { kind: 'skip' };
  }
  const resolved = path.resolve(absoluteBaseDir, candidate);
  if (!isInsideDirectory(resolved, absoluteBaseDir)) {
    return { kind: 'skip' };
  }
  if (pathExists(resolved)) {
    return { kind: 'present', absolutePath: resolved };
  }
  return { kind: 'missing', relativePath: candidate };
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Rewrites skill-relative supporting-file paths that exist on disk to absolute
 * paths, and marks referenced paths that are not in the installed skill tree.
 */
export function expandSkillSupportingPaths(params: {
  body: string;
  absoluteBaseDir: string;
}): ExpandedSkillBody {
  const tokenPattern =
    /`([^`\n]{1,400})`|\[([^\]]*)\]\((<)?([^)\s>]+)(>)?(?:\s+"[^"]*")?\)/g;
  const presentPaths: string[] = [];
  const missingPaths: string[] = [];
  const body = params.body.replace(
    tokenPattern,
    (match, backtick: string | undefined, _text: string | undefined, _lt: string | undefined, dest: string | undefined) => {
      const raw = backtick ?? dest;
      if (raw === undefined) {
        return match;
      }
      const classified = classifyRelativePath(raw, params.absoluteBaseDir);
      if (classified.kind === 'present') {
        presentPaths.push(classified.absolutePath);
        if (backtick !== undefined) {
          return `\`${classified.absolutePath}\``;
        }
        const destIndex = match.lastIndexOf(raw);
        if (destIndex === -1) {
          return match;
        }
        return `${match.slice(0, destIndex)}${classified.absolutePath}${match.slice(destIndex + raw.length)}`;
      }
      if (classified.kind === 'missing') {
        missingPaths.push(classified.relativePath);
        if (backtick !== undefined) {
          return `${classified.relativePath}${MISSING_NOTE}`;
        }
        return `${match}${MISSING_NOTE}`;
      }
      return match;
    },
  );

  return {
    body,
    presentPaths: uniqueInOrder(presentPaths).sort((a, b) => a.localeCompare(b)),
    missingPaths: uniqueInOrder(missingPaths),
    rootEntries: listSkillRoot(params.absoluteBaseDir),
  };
}

function formatBulletList(heading: string, lines: readonly string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  return [heading, ...lines.map((line) => `- ${line}`)];
}

function withBlankLine(lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : ['', ...lines];
}

export function formatSkillToolBlock(params: {
  name: string;
  location: string;
  body: string;
  absoluteBaseDir: string;
}): string {
  const expanded = expandSkillSupportingPaths({
    body: params.body,
    absoluteBaseDir: params.absoluteBaseDir,
  });
  const preamble = [
    'Read supporting files with obsidian_read_external using the absolute paths in this result. You may list the skill directory with obsidian_list_external. Do not join relative names onto that directory, and do not use obsidian_read.',
    '',
    `Skill directory: ${params.absoluteBaseDir}`,
    ...withBlankLine(formatBulletList(
      'Contents:',
      expanded.rootEntries.map((entry) => `${entry.path} (${entry.kind})`),
    )),
    ...withBlankLine(formatBulletList('Present supporting files:', expanded.presentPaths)),
    ...withBlankLine(formatBulletList('Not present in this skill (do not read):', expanded.missingPaths)),
  ].join('\n');

  return `<skill name="${params.name}" location="${params.location}">
${preamble}

${expanded.body}
</skill>`;
}
