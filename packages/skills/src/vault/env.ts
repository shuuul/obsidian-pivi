import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';
const NODE_EXECUTABLE = isWindows ? 'node.exe' : 'node';
const NPX_EXECUTABLE = isWindows ? 'npx.cmd' : 'npx';

function getEnvValue(key: string): string | undefined {
  const hasKey = (name: string): boolean => name in process.env && process.env[name] !== undefined;

  if (hasKey(key)) {
    return process.env[key];
  }

  if (!isWindows) {
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

  let expanded = value;

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

function expandHomePath(p: string): string {
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

function translateMsysPath(value: string): string {
  if (!isWindows) {
    return value;
  }

  const match = value.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) {
    return value;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2]?.replace(/\//g, '\\') ?? '';
  return `${drive}:\\${rest}`;
}

function parsePathEntries(pathValue?: string): string[] {
  if (!pathValue) {
    return [];
  }

  const delimiter = isWindows ? ';' : ':';

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
    const entryVersion = entry.slice(1);
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

function resolveNvmDefaultBin(home: string): string | null {
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

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function getAppProvidedBinaryPaths(): string[] {
  if (process.platform === 'darwin') {
    const appBundleMatch = process.execPath.match(/^(.+?\.app)\//);
    if (appBundleMatch) {
      return [path.join(appBundleMatch[1], 'Contents', 'MacOS')];
    }
    return [path.dirname(process.execPath)];
  }

  if (isWindows) {
    return [path.dirname(process.execPath)];
  }

  return [];
}

function getExtraBinaryPaths(): string[] {
  const home = getHomeDir();

  if (isWindows) {
    const paths: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programData = process.env.ProgramData || 'C:\\ProgramData';

    if (appData) paths.push(path.join(appData, 'npm'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'nodejs'));
      paths.push(path.join(localAppData, 'Programs', 'node'));
    }

    paths.push(path.join(programFiles, 'nodejs'));
    paths.push(path.join(programFilesX86, 'nodejs'));

    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) paths.push(nvmSymlink);

    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path.join(appData, 'nvm'));
    }

    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    } else if (home) {
      paths.push(path.join(home, '.volta', 'bin'));
    }

    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) paths.push(fnmMultishell);

    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path.join(localAppData, 'fnm'));
    }

    const chocolateyInstall = process.env.ChocolateyInstall;
    paths.push(chocolateyInstall ? path.join(chocolateyInstall, 'bin') : path.join(programData, 'chocolatey', 'bin'));

    const scoopDir = process.env.SCOOP;
    if (scoopDir) {
      paths.push(path.join(scoopDir, 'shims'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current'));
    } else if (home) {
      paths.push(path.join(home, 'scoop', 'shims'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current'));
    }

    paths.push(path.join(programFiles, 'Docker', 'Docker', 'resources', 'bin'));

    if (home) {
      paths.push(path.join(home, '.local', 'bin'));
      paths.push(path.join(home, '.bun', 'bin'));
    }

    paths.push(...getAppProvidedBinaryPaths());
    return paths;
  }

  const paths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];

  const voltaHome = process.env.VOLTA_HOME;
  if (voltaHome) paths.push(path.join(voltaHome, 'bin'));

  const asdfRoot = process.env.ASDF_DATA_DIR || process.env.ASDF_DIR;
  if (asdfRoot) {
    paths.push(path.join(asdfRoot, 'shims'));
    paths.push(path.join(asdfRoot, 'bin'));
  }

  const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
  if (fnmMultishell) paths.push(fnmMultishell);

  if (home) {
    paths.push(path.join(home, '.local', 'bin'));
    paths.push(path.join(home, '.bun', 'bin'));
    paths.push(path.join(home, '.docker', 'bin'));
    paths.push(path.join(home, '.volta', 'bin'));
    paths.push(path.join(home, '.asdf', 'shims'));
    paths.push(path.join(home, '.asdf', 'bin'));
    paths.push(path.join(home, '.fnm'));

    const nvmBin = process.env.NVM_BIN;
    if (nvmBin) {
      paths.push(nvmBin);
    } else {
      const nvmDefault = resolveNvmDefaultBin(home);
      if (nvmDefault) paths.push(nvmDefault);
    }
  }

  paths.push(...getAppProvidedBinaryPaths());
  return paths;
}

function collectBinarySearchPaths(additionalPaths?: string): string[] {
  const searchPaths = getExtraBinaryPaths();
  const currentPath = process.env.PATH || '';
  const pathDirs = parsePathEntries(currentPath);
  const additionalDirs = additionalPaths ? parsePathEntries(additionalPaths) : [];
  return [...additionalDirs, ...searchPaths, ...pathDirs];
}

function findExecutableInSearchPaths(
  executableName: string,
  additionalPaths?: string,
): string | null {
  for (const dir of collectBinarySearchPaths(additionalPaths)) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, executableName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Inaccessible directory
    }
  }
  return null;
}

function findNodeDirectory(additionalPaths?: string): string | null {
  for (const dir of collectBinarySearchPaths(additionalPaths)) {
    if (!dir) continue;
    try {
      const nodePath = path.join(dir, NODE_EXECUTABLE);
      if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
        return dir;
      }
    } catch {
      // Inaccessible directory
    }
  }

  return null;
}

function findNodeExecutable(additionalPaths?: string): string | null {
  const nodeDir = findNodeDirectory(additionalPaths);
  return nodeDir ? path.join(nodeDir, NODE_EXECUTABLE) : null;
}

export function findNpxExecutable(additionalPaths?: string): string | null {
  const nodeExecutable = findNodeExecutable(additionalPaths);
  if (nodeExecutable) {
    const sibling = path.join(path.dirname(nodeExecutable), NPX_EXECUTABLE);
    try {
      if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) {
        return sibling;
      }
    } catch {
      // fall through to PATH search
    }
  }

  return findExecutableInSearchPaths(NPX_EXECUTABLE, additionalPaths);
}

function getEnhancedPath(additionalPaths?: string): string {
  const extraPaths = getExtraBinaryPaths().filter(p => p);
  const currentPath = process.env.PATH || '';

  const segments: string[] = [];

  if (additionalPaths) {
    segments.push(...parsePathEntries(additionalPaths));
  }

  segments.push(...extraPaths);

  if (currentPath) {
    segments.push(...parsePathEntries(currentPath));
  }

  const seen = new Set<string>();
  const unique = segments.filter(p => {
    const normalized = isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return unique.join(PATH_SEPARATOR);
}

export function getSpawnEnvWithEnhancedPath(additionalPaths?: string): NodeJS.ProcessEnv {
  const pathValue = getEnhancedPath(additionalPaths);
  if (isWindows) {
    return { ...process.env, PATH: pathValue, Path: pathValue };
  }
  return { ...process.env, PATH: pathValue };
}

const NPX_NOT_FOUND_MESSAGE =
  'Could not find npx. Install Node.js (https://nodejs.org) or add npx to PATH. '
  + 'Obsidian runs with a minimal PATH; Pivi searches Homebrew, nvm, and other common locations.';

export function formatNpxNotFoundError(): string {
  const nodeDir = findNodeDirectory();
  if (nodeDir) {
    return `${NPX_NOT_FOUND_MESSAGE} Found node in ${nodeDir} but not npx alongside it.`;
  }
  return NPX_NOT_FOUND_MESSAGE;
}
