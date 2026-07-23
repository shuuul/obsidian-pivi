import * as fs from 'node:fs';
import * as path from 'node:path';

import { normalizePathForComparison, normalizePathForFilesystem } from '@pivi/obsidian-host/path';
import { tokenizeBashArgv } from '@pivi/pivi-agent-core/tools';

export const DEFAULT_SAFE_BASH_ALLOWLIST = ['which', 'type', 'pwd'] as const;

export interface BashAllowlistEntry {
  /** Executable name or absolute path as configured by the user. */
  executable: string;
  /** Required leading argv schema after the executable. Empty allows any args. */
  argsPrefix: readonly string[];
}

export interface ResolvedBashInvocation {
  executablePath: string;
  args: readonly string[];
}

function normalizeAllowlist(value: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value ?? []) {
    const command = entry.trim();
    if (!command || seen.has(command)) {
      continue;
    }
    seen.add(command);
    normalized.push(command);
  }
  return normalized;
}

export function buildEffectiveBashAllowlist(userAllowlist?: readonly string[]): readonly string[] {
  return normalizeAllowlist([...DEFAULT_SAFE_BASH_ALLOWLIST, ...(userAllowlist ?? [])]);
}

/** Parse a settings allowlist string into executable + required argv prefix. */
export function parseBashAllowlistEntry(entry: string): BashAllowlistEntry | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  const tokens = tokenizeBashArgv(trimmed);
  if (tokens.length === 0) {
    return null;
  }
  const [executable, ...argsPrefix] = tokens;
  if (!executable) {
    return null;
  }
  return { executable, argsPrefix };
}

export const tokenizeArgv = tokenizeBashArgv;

function pathLookupDirs(envPath: string | undefined): string[] {
  if (!envPath) {
    return [];
  }
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return envPath.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

function candidateExecutableNames(name: string): string[] {
  if (process.platform !== 'win32') {
    return [name];
  }
  const lower = name.toLowerCase();
  if (lower.endsWith('.exe') || lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.com')) {
    return [name];
  }
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  return [name, ...pathext.map((ext) => `${name}${ext}`)];
}

/**
 * Resolve an executable name or path to a canonical filesystem path.
 * Absolute paths must exist; bare names are looked up on PATH.
 */
export function resolveExecutablePath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const normalized = normalizePathForFilesystem(executable);
  if (!normalized) {
    return null;
  }

  const realpathFn = (fs.realpathSync.native ?? fs.realpathSync) as (value: fs.PathLike) => string;

  if (path.isAbsolute(normalized)) {
    try {
      if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
        return null;
      }
      return realpathFn(normalized);
    } catch {
      return null;
    }
  }

  for (const dir of pathLookupDirs(env.PATH)) {
    for (const candidateName of candidateExecutableNames(normalized)) {
      const candidate = path.join(dir, candidateName);
      try {
        if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
          continue;
        }
        return realpathFn(candidate);
      } catch {
        // keep searching
      }
    }
  }
  return null;
}

function argsMatchPrefix(args: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length === 0) {
    return true;
  }
  if (args.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (args[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

function sameExecutable(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

/**
 * Match a tokenized invocation against the structured allowlist using
 * canonical executable paths and argv schemas (not command-string prefixes).
 */
export function matchBashAllowlist(
  tokens: readonly string[],
  allowlist: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBashInvocation | null {
  if (tokens.length === 0) {
    return null;
  }
  const [rawExecutable, ...args] = tokens;
  if (!rawExecutable) {
    return null;
  }

  const resolvedExecutable = resolveExecutablePath(rawExecutable, env);
  if (!resolvedExecutable) {
    return null;
  }

  for (const entry of allowlist) {
    const parsed = parseBashAllowlistEntry(entry);
    if (!parsed) {
      continue;
    }
    const allowedExecutable = resolveExecutablePath(parsed.executable, env);
    if (!allowedExecutable || !sameExecutable(resolvedExecutable, allowedExecutable)) {
      continue;
    }
    if (!argsMatchPrefix(args, parsed.argsPrefix)) {
      continue;
    }
    return { executablePath: resolvedExecutable, args };
  }
  return null;
}
