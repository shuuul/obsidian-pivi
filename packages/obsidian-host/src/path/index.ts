import * as fs from 'fs';
import type { App } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

export function getVaultPath(app: App): string | null {
  const basePath = (app.vault.adapter as { basePath?: unknown } | undefined)?.basePath;
  return typeof basePath === 'string' ? basePath : null;
}

function getEnvValue(key: string): string | undefined {
  const hasKey = (name: string): boolean => name in process.env && process.env[name] !== undefined;

  if (hasKey(key)) {
    return process.env[key];
  }

  if (process.platform !== 'win32') {
    return undefined;
  }

  const upper = key.toUpperCase();
  if (hasKey(upper)) {
    return process.env[upper];
  }

  const lower = key.toLowerCase();
  if (hasKey(lower)) {
    return process.env[lower];
  }

  const matchKey = Object.keys(process.env).find((name) => name.toLowerCase() === key.toLowerCase());
  return matchKey ? process.env[matchKey] : undefined;
}

function expandEnvironmentVariables(value: string): string {
  if (!value.includes('%') && !value.includes('$') && !value.includes('!')) {
    return value;
  }

  const isWindows = process.platform === 'win32';
  let expanded = value;

  // Windows %VAR% format - allow parentheses for vars like %ProgramFiles(x86)%
  expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*(?:\([A-Za-z0-9_]+\))?[A-Za-z0-9_]*)%/g, (match: string, name: string): string => {
    const envValue = getEnvValue(name);
    return envValue !== undefined ? envValue : match;
  });

  if (isWindows) {
    expanded = expanded.replace(/!([A-Za-z_][A-Za-z0-9_]*)!/g, (match: string, name: string): string => {
      const envValue = getEnvValue(name);
      return envValue !== undefined ? envValue : match;
    });

    expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (match: string, name: string): string => {
      const envValue = getEnvValue(name);
      return envValue !== undefined ? envValue : match;
    });
  }

  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match: string, name1: string | undefined, name2: string | undefined): string => {
    const key = name1 ?? name2;
    if (!key) return match;
    const envValue = getEnvValue(key);
    return envValue !== undefined ? envValue : match;
  });

  return expanded;
}

export function expandHomePath(p: string): string {
  const expanded = expandEnvironmentVariables(p);
  if (expanded === '~') {
    return os.homedir();
  }
  if (expanded.startsWith('~/')) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  if (expanded.startsWith('~\\')) {
    return path.join(os.homedir(), expanded.slice(2));
  }
  return expanded;
}

function stripSurroundingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parsePathEntries(pathValue?: string): string[] {
  if (!pathValue) {
    return [];
  }

  const delimiter = process.platform === 'win32' ? ';' : ':';

  return pathValue
    .split(delimiter)
    .map(segment => stripSurroundingQuotes(segment.trim()))
    .filter(segment => {
      if (!segment) return false;
      const upper = segment.toUpperCase();
      return upper !== '$PATH' && upper !== '${PATH}' && upper !== '%PATH%';
    })
    .map(segment => translateMsysPath(expandHomePath(segment)));
}


const NVM_LATEST_INSTALLED_ALIASES = new Set(['node', 'stable']);

function isNvmBuiltInLatestAlias(alias: string): boolean {
  return NVM_LATEST_INSTALLED_ALIASES.has(alias);
}

function findMatchingNvmVersion(entries: string[], resolvedAlias: string): string | undefined {
  if (isNvmBuiltInLatestAlias(resolvedAlias)) {
    return entries[0];
  }

  const version = resolvedAlias.replace(/^v/, '');
  return entries.find(entry => {
    const entryVersion = entry.slice(1); // strip 'v'
    return entryVersion === version || entryVersion.startsWith(version + '.');
  });
}

function resolveNvmAlias(nvmDir: string, alias: string, depth = 0): string | null {
  if (depth > 5) return null;

  if (/^\d/.test(alias) || alias.startsWith('v')) return alias;
  if (isNvmBuiltInLatestAlias(alias)) return alias;

  try {
    const aliasFile = path.join(nvmDir, 'alias', ...alias.split('/'));
    const target = fs.readFileSync(aliasFile, 'utf8').trim();
    if (!target) return null;
    return resolveNvmAlias(nvmDir, target, depth + 1);
  } catch {
    return null;
  }
}

// GUI apps don't have NVM_BIN set, so we resolve nvm's default alias
// from the filesystem and match against installed versions.
export function resolveNvmDefaultBin(home: string): string | null {
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');

  try {
    const alias = fs.readFileSync(path.join(nvmDir, 'alias', 'default'), 'utf8').trim();
    if (!alias) return null;

    const resolved = resolveNvmAlias(nvmDir, alias);
    if (!resolved) return null;

    const versionsDir = path.join(nvmDir, 'versions', 'node');
    const entries = fs.readdirSync(versionsDir)
      .filter(entry => entry.startsWith('v'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    const matched = findMatchingNvmVersion(entries, resolved);

    if (matched) {
      const binDir = path.join(versionsDir, matched, 'bin');
      if (fs.existsSync(binDir)) return binDir;
    }
  } catch {
    // nvm not installed
  }

  return null;
}

// Best-effort realpath: if the full path doesn't exist, resolve the nearest
// existing ancestor and re-append the remaining segments.
function resolveRealPath(p: string): string {
  const realpathFn = (fs.realpathSync.native ?? fs.realpathSync) as (path: fs.PathLike) => string;

  try {
    return realpathFn(p);
  } catch {
    const absolute = path.resolve(p);
    let current = absolute;
    const suffix: string[] = [];

    for (;;) {
      try {
        if (fs.existsSync(current)) {
          const resolvedExisting = realpathFn(current);
          return suffix.length > 0
            ? path.join(resolvedExisting, ...suffix.reverse())
            : resolvedExisting;
        }
      } catch {
        // Keep walking up
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return absolute;
      }

      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

// Translates MSYS/Git Bash paths (/c/Users/...) to Windows paths (C:\Users\...).
// Must be called before path.resolve() or path.isAbsolute().
export function translateMsysPath(value: string): string {
  if (process.platform !== 'win32') {
    return value;
  }

  const msysMatch = value.match(/^\/([a-zA-Z])(\/.*)?$/);
  if (msysMatch) {
    const [, drive, restOfPath = ''] = msysMatch;
    if (!drive) {
      return value;
    }
    const driveLetter = drive.toUpperCase();
    return `${driveLetter}:${restOfPath.replace(/\//g, '\\')}`;
  }

  return value;
}

function normalizePathBeforeResolution(p: string): string {
  const expanded = expandHomePath(p);
  return translateMsysPath(expanded);
}

function normalizeWindowsPathPrefix(value: string): string {
  if (process.platform !== 'win32') {
    return value;
  }

  const normalized = translateMsysPath(value);

  if (normalized.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`;
  }

  if (normalized.startsWith('\\\\?\\')) {
    return normalized.slice('\\\\?\\'.length);
  }

  return normalized;
}

export function normalizePathForFilesystem(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const expanded = normalizePathBeforeResolution(value);
  const normalized = (() => {
    try {
      return process.platform === 'win32'
        ? path.win32.normalize(expanded)
        : path.normalize(expanded);
    } catch {
      return expanded;
    }
  })();

  return normalizeWindowsPathPrefix(normalized);
}

export function normalizePathForComparison(value: string): string {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const expanded = normalizePathBeforeResolution(value);
  const normalized = (() => {
    try {
      return process.platform === 'win32'
        ? path.win32.normalize(expanded)
        : path.normalize(expanded);
    } catch {
      return expanded;
    }
  })();

  const normalizedWithPrefix = normalizeWindowsPathPrefix(normalized)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');

  return process.platform === 'win32'
    ? normalizedWithPrefix.toLowerCase()
    : normalizedWithPrefix;
}

export function isPathWithinDirectory(
  candidatePath: string,
  directoryPath: string,
  relativeBasePath?: string,
): boolean {
  if (!candidatePath || !directoryPath) {
    return false;
  }

  const directoryReal = normalizePathForComparison(resolveRealPath(directoryPath));
  const normalizedCandidate = normalizePathForFilesystem(candidatePath);
  if (!normalizedCandidate) {
    return false;
  }

  const absCandidate = path.isAbsolute(normalizedCandidate)
    ? normalizedCandidate
    : path.resolve(relativeBasePath ?? directoryPath, normalizedCandidate);

  const resolvedCandidate = normalizePathForComparison(resolveRealPath(absCandidate));
  return resolvedCandidate === directoryReal || resolvedCandidate.startsWith(directoryReal + '/');
}

export function isPathWithinVault(candidatePath: string, vaultPath: string): boolean {
  return isPathWithinDirectory(candidatePath, vaultPath, vaultPath);
}

export function normalizePathForVault(
  rawPath: string | undefined | null,
  vaultPath: string | null | undefined
): string | null {
  if (!rawPath) return null;

  const normalizedRaw = normalizePathForFilesystem(rawPath);
  if (!normalizedRaw) return null;

  if (vaultPath && isPathWithinVault(normalizedRaw, vaultPath)) {
    const absolute = path.isAbsolute(normalizedRaw)
      ? normalizedRaw
      : path.resolve(vaultPath, normalizedRaw);
    const relative = path.relative(vaultPath, absolute);
    return relative ? relative.replace(/\\/g, '/') : null;
  }

  return normalizedRaw.replace(/\\/g, '/');
}

function containsNul(value: string): boolean {
  return value.includes('\0');
}

function isAbsoluteOrDrivePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:$/.test(value)) {
    return true;
  }
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    return true;
  }
  if (/^\\\\[.?]\\/.test(value) || value.startsWith('\\\\.\\') || value.startsWith('\\\\?\\')) {
    return true;
  }
  return false;
}

function hasInvalidSeparatorMix(value: string): boolean {
  // Reject Windows UNC/device forms and drive-relative segments in vault-relative input.
  if (value.includes('\\\\') || value.includes('//')) {
    return true;
  }
  if (/^[A-Za-z]:/.test(value)) {
    return true;
  }
  return false;
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * Validates a vault mutation target and returns a non-empty canonical
 * vault-relative path using `/` separators. Unlike `normalizePathForVault`,
 * this never returns an external/absolute path and fails loudly on escape.
 */
export function requireVaultRelativeMutationPath(
  rawPath: string | undefined | null,
  vaultPath: string | null | undefined,
): string {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('Vault mutation path must be a non-empty vault-relative path');
  }
  if (!vaultPath || typeof vaultPath !== 'string' || !vaultPath.trim()) {
    throw new Error('Vault path is required for mutation containment');
  }

  const trimmed = rawPath.trim();
  if (containsNul(trimmed)) {
    throw new Error('Vault mutation path must not contain NUL');
  }
  if (process.platform !== 'win32' && trimmed.includes('\\')) {
    throw new Error('Vault mutation path must not contain backslash separators on this platform');
  }
  if (trimmed === '.' || trimmed === './' || trimmed === '.\\') {
    throw new Error('Vault mutation path must not be the vault root');
  }
  if (isAbsoluteOrDrivePath(trimmed) || hasInvalidSeparatorMix(trimmed)) {
    throw new Error(`Vault mutation path must be vault-relative: ${trimmed}`);
  }
  if (hasTraversalSegment(trimmed)) {
    throw new Error(`Vault mutation path must not contain traversal segments: ${trimmed}`);
  }

  const expanded = normalizePathBeforeResolution(trimmed);
  if (isAbsoluteOrDrivePath(expanded) || hasTraversalSegment(expanded)) {
    throw new Error(`Vault mutation path must be vault-relative: ${trimmed}`);
  }

  const normalized = process.platform === 'win32'
    ? path.win32.normalize(expanded)
    : path.normalize(expanded);
  if (!normalized || normalized === '.' || isAbsoluteOrDrivePath(normalized) || hasTraversalSegment(normalized)) {
    throw new Error(`Vault mutation path must be vault-relative: ${trimmed}`);
  }

  const absolute = path.resolve(vaultPath, normalized);
  if (!isPathWithinDirectory(absolute, vaultPath, vaultPath)) {
    throw new Error(`Vault mutation path escapes the vault: ${trimmed}`);
  }

  // The contract promises `/` separators; path.relative emits `\` on Windows,
  // so normalize unconditionally instead of trusting the host platform branch.
  const relative = path.relative(vaultPath, absolute).replace(/\\/g, '/');
  if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`Vault mutation path must be a non-empty vault-relative path: ${trimmed}`);
  }
  return relative;
}

/** Management tools that own Pivi-managed vault namespaces (spec 040). */
export type PiviManagedPathTool = 'pivi_mcp' | 'pivi_skills' | 'pivi_commands';

export type AgentManagedPathMutationMode = 'direct' | 'recursive';

interface ManagedPathNamespace {
  tool: PiviManagedPathTool;
  /** Exact files (vault-relative, `/` separators). */
  files: readonly string[];
  /**
   * Basename/path prefixes for publication artifacts beside an exact file
   * (e.g. `.pivi/mcp.json.corrupt-*`, `.tmp-*`, `.bak-*`).
   */
  filePrefixes: readonly string[];
  /** Directory roots: exact path and all descendants. */
  directories: readonly string[];
}

const PIVI_SKILLS_TRANSACTION_ROOT_PREFIX = '.pivi/.skills-transaction-';
const PIVI_COMMANDS_REMOVAL_ROOT_PREFIX = '.pivi/.commands-removal-';

/**
 * Pivi-managed namespaces that standard Agent vault mutations must not alter.
 * Unrelated `.pivi/*` paths (sessions, settings, prompts, …) stay writable.
 */
const PIVI_MANAGED_PATH_NAMESPACES: readonly ManagedPathNamespace[] = [
  {
    tool: 'pivi_mcp',
    files: ['.pivi/mcp.json'],
    filePrefixes: ['.pivi/mcp.json.'],
    directories: ['.pivi/mcp-oauth'],
  },
  {
    tool: 'pivi_skills',
    files: [
      '.pivi/skills-lock.json',
      '.pivi/.skills.json',
      // Legacy CLI metadata before migration into `.pivi/`.
      'skills-lock.json',
      '.skills.json',
    ],
    filePrefixes: [],
    directories: [
      '.pivi/skills',
      '.pivi/skills-staging',
      '.pivi/skills-install-',
      '.pivi/skills-list-',
      '.pivi/skills-remove-',
      '.pivi/skills-update-',
      '.pivi/skills-update-all-',
      '.pivi/skills-default-update-',
      PIVI_SKILLS_TRANSACTION_ROOT_PREFIX,
      '.pivi/.skills-publication-',
      '.pivi/.skills-backup-',
      '.pivi/.agents/skills',
      '.pivi/.cursor/skills',
    ],
  },
  {
    tool: 'pivi_commands',
    files: [],
    filePrefixes: [],
    directories: ['.pivi/commands', '.pivi/templates', PIVI_COMMANDS_REMOVAL_ROOT_PREFIX],
  },
];

function canonicalizeVaultRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isExactOrDescendant(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`)
    || (root.endsWith('-') && candidate.startsWith(root));
}

function isStrictAncestor(candidate: string, root: string): boolean {
  return root.startsWith(`${candidate}/`);
}

function matchesManagedNamespace(
  candidate: string,
  namespace: ManagedPathNamespace,
  mode: AgentManagedPathMutationMode,
): boolean {
  for (const file of namespace.files) {
    if (candidate === file) {
      return true;
    }
    if (mode === 'recursive' && isStrictAncestor(candidate, file)) {
      return true;
    }
  }
  for (const prefix of namespace.filePrefixes) {
    if (candidate.startsWith(prefix)) {
      return true;
    }
    // Recursive parent of artifact siblings (e.g. deleting `.pivi` removes mcp.json.*).
    const parent = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    if (mode === 'recursive' && parent && (candidate === parent || isStrictAncestor(candidate, parent))) {
      return true;
    }
  }
  for (const dir of namespace.directories) {
    if (isExactOrDescendant(candidate, dir)) {
      return true;
    }
    if (mode === 'recursive' && isStrictAncestor(candidate, dir)) {
      return true;
    }
  }
  return false;
}

function findManagedPathConflict(
  vaultRelativePath: string,
  mode: AgentManagedPathMutationMode,
): ManagedPathNamespace | null {
  const candidate = canonicalizeVaultRelativePath(vaultRelativePath);
  if (!candidate) {
    return null;
  }
  for (const namespace of PIVI_MANAGED_PATH_NAMESPACES) {
    if (matchesManagedNamespace(candidate, namespace, mode)) {
      return namespace;
    }
  }
  return null;
}

/**
 * Rejects Agent vault mutations whose normalized target overlaps a Pivi-managed
 * MCP, Skills, or Commands namespace.
 *
 * - `direct`: exact managed path or descendant (write/edit/mkdir-into/move dest).
 * - `recursive`: also ancestors that would recursively alter managed content
 *   (delete/move source/mkdir of a parent that owns managed children).
 *
 * Call after `requireVaultRelativeMutationPath`. Does not claim Bash containment.
 */
export function assertAgentManagedPathMutationAllowed(
  vaultRelativePath: string,
  options: { mode?: AgentManagedPathMutationMode } = {},
): void {
  const mode = options.mode ?? 'direct';
  const conflict = findManagedPathConflict(vaultRelativePath, mode);
  if (!conflict) {
    return;
  }
  const displayPath = canonicalizeVaultRelativePath(vaultRelativePath);
  throw new Error(
    `Path "${displayPath}" is managed by Pivi. `
    + `Use the \`${conflict.tool}\` tool instead of generic vault mutation APIs.`,
  );
}

export function requireAgentVaultMutationPath(
  rawPath: string | undefined | null,
  vaultPath: string | null | undefined,
  options: { mode?: AgentManagedPathMutationMode } = {},
): string {
  const normalized = requireVaultRelativeMutationPath(rawPath, vaultPath);
  assertAgentManagedPathMutationAllowed(normalized, options);
  if (vaultPath) {
    const absolute = path.resolve(vaultPath, normalized);
    const resolved = resolveRealPath(absolute);
    const realVault = resolveRealPath(vaultPath);
    const resolvedRelative = path.relative(realVault, resolved).replace(/\\/g, '/');
    if (resolvedRelative && resolvedRelative !== '.' && !resolvedRelative.startsWith('../')) {
      assertAgentManagedPathMutationAllowed(resolvedRelative, options);
    }
  }
  return normalized;
}
