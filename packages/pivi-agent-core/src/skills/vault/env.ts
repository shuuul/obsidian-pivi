import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SkillsProcessEnv = Record<string, string | undefined>;

export interface SkillsEnvironmentOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  homeDir?: string;
}

interface SkillsEnvironmentContext {
  processEnv: SkillsProcessEnv;
  platform: NodeJS.Platform;
  execPath: string;
  homeDir: string;
  isWindows: boolean;
  pathSeparator: string;
  nodeExecutable: string;
  npxExecutable: string;
}

function createSkillsEnvironmentContext(
  processEnv: SkillsProcessEnv = process.env,
  options: SkillsEnvironmentOptions = {},
): SkillsEnvironmentContext {
  const platform = options.platform ?? process.platform;
  const isWindows = platform === 'win32';
  return {
    processEnv,
    platform,
    execPath: options.execPath ?? process.execPath,
    homeDir: options.homeDir ?? os.homedir(),
    isWindows,
    pathSeparator: isWindows ? ';' : ':',
    nodeExecutable: isWindows ? 'node.exe' : 'node',
    npxExecutable: isWindows ? 'npx.cmd' : 'npx',
  };
}

export function isWindowsSkillsEnvironment(options?: SkillsEnvironmentOptions): boolean {
  return createSkillsEnvironmentContext(undefined, options).isWindows;
}

function getEnvValue(key: string, context: SkillsEnvironmentContext): string | undefined {
  const { processEnv } = context;
  const directValue = processEnv[key];
  if (directValue !== undefined) {
    return directValue;
  }

  if (!context.isWindows) {
    return undefined;
  }

  const upperValue = processEnv[key.toUpperCase()];
  if (upperValue !== undefined) {
    return upperValue;
  }

  const lowerValue = processEnv[key.toLowerCase()];
  if (lowerValue !== undefined) {
    return lowerValue;
  }

  const matchKey = Object.keys(processEnv).find((name) => name.toLowerCase() === key.toLowerCase());
  if (!matchKey) {
    return undefined;
  }
  const matchedValue = processEnv[matchKey];
  return matchedValue !== undefined ? matchedValue : undefined;
}

function expandEnvironmentVariables(value: string, context: SkillsEnvironmentContext): string {
  if (!value.includes('%') && !value.includes('$') && !value.includes('!')) {
    return value;
  }

  let expanded = value;

  expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*(?:\([A-Za-z0-9_]+\))?[A-Za-z0-9_]*)%/g, (match: string, name: string): string => {
    const envValue = getEnvValue(name, context);
    return envValue !== undefined ? envValue : match;
  });

  if (context.isWindows) {
    expanded = expanded.replace(/!([A-Za-z_][A-Za-z0-9_]*)!/g, (match: string, name: string): string => {
      const envValue = getEnvValue(name, context);
      return envValue !== undefined ? envValue : match;
    });

    expanded = expanded.replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (match: string, name: string): string => {
      const envValue = getEnvValue(name, context);
      return envValue !== undefined ? envValue : match;
    });
  }

  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match: string, name1: string | undefined, name2: string | undefined): string => {
    const key = name1 ?? name2;
    if (!key) return match;
    const envValue = getEnvValue(key, context);
    return envValue !== undefined ? envValue : match;
  });

  return expanded;
}

function expandHomePath(p: string, context: SkillsEnvironmentContext): string {
  const expanded = expandEnvironmentVariables(p, context);
  const homeDir = context.processEnv.HOME || context.processEnv.USERPROFILE || context.homeDir;
  if (expanded === '~') {
    return homeDir;
  }
  if (expanded.startsWith('~/')) {
    return path.join(homeDir, expanded.slice(2));
  }
  if (expanded.startsWith('~\\')) {
    return path.join(homeDir, expanded.slice(2));
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

function translateMsysPath(value: string, context: SkillsEnvironmentContext): string {
  if (!context.isWindows) {
    return value;
  }

  const match = value.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  const drive = match?.[1];
  if (!drive) {
    return value;
  }
  const rest = match[2]?.replace(/\//g, '\\') ?? '';
  return `${drive.toUpperCase()}:\\${rest}`;
}

function parsePathEntries(pathValue: string | undefined, context: SkillsEnvironmentContext): string[] {
  if (!pathValue) {
    return [];
  }

  return pathValue
    .split(context.pathSeparator)
    .map(segment => stripSurroundingQuotes(segment.trim()))
    .filter(segment => {
      if (!segment) return false;
      const upper = segment.toUpperCase();
      return upper !== '$PATH' && upper !== '${PATH}' && upper !== '%PATH%';
    })
    .map(segment => translateMsysPath(expandHomePath(segment, context), context));
}

const NVM_LATEST_INSTALLED_ALIASES = new Set(['node', 'stable']);

function isNvmBuiltInLatestAlias(alias: string): boolean {
  return NVM_LATEST_INSTALLED_ALIASES.has(alias);
}

function findMatchingNvmVersion(entries: string[], resolvedAlias: string): string | undefined {
  if (isNvmBuiltInLatestAlias(resolvedAlias)) {
    return entries.at(0);
  }

  const version = resolvedAlias.replace(/^v/, '');
  return entries.find(entry => {
    const entryVersion = entry.slice(1);
    return entryVersion === version || entryVersion.startsWith(version + '.');
  });
}

function resolveNvmAlias(nvmDir: string, alias: string, processEnv: SkillsProcessEnv, depth = 0): string | null {
  if (depth > 5) return null;

  if (/^\d/.test(alias) || alias.startsWith('v')) return alias;
  if (isNvmBuiltInLatestAlias(alias)) return alias;

  try {
    const aliasFile = path.join(nvmDir, 'alias', ...alias.split('/'));
    const target = fs.readFileSync(aliasFile, 'utf8').trim();
    if (!target) return null;
    return resolveNvmAlias(nvmDir, target, processEnv, depth + 1);
  } catch {
    return null;
  }
}

function resolveNvmDefaultBin(home: string, processEnv: SkillsProcessEnv): string | null {
  const nvmDir = processEnv.NVM_DIR || path.join(home, '.nvm');

  try {
    const alias = fs.readFileSync(path.join(nvmDir, 'alias', 'default'), 'utf8').trim();
    if (!alias) return null;

    const resolved = resolveNvmAlias(nvmDir, alias, processEnv);
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

function getHomeDir(context: SkillsEnvironmentContext): string {
  return context.processEnv.HOME || context.processEnv.USERPROFILE || context.homeDir;
}

function getAppProvidedBinaryPaths(context: SkillsEnvironmentContext): string[] {
  if (context.platform === 'darwin') {
    const appBundleMatch = context.execPath.match(/^(.+?\.app)\//);
    const appBundlePath = appBundleMatch?.[1];
    if (appBundlePath) {
      return [path.join(appBundlePath, 'Contents', 'MacOS')];
    }
    return [path.dirname(context.execPath)];
  }

  if (context.isWindows) {
    return [path.dirname(context.execPath)];
  }

  return [];
}

function getExtraBinaryPaths(context: SkillsEnvironmentContext): string[] {
  const { processEnv } = context;
  const home = getHomeDir(context);

  if (context.isWindows) {
    const paths: string[] = [];
    const localAppData = processEnv.LOCALAPPDATA;
    const appData = processEnv.APPDATA;
    const programFiles = processEnv.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = processEnv['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programData = processEnv.ProgramData || 'C:\\ProgramData';

    if (appData) paths.push(path.join(appData, 'npm'));
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'nodejs'));
      paths.push(path.join(localAppData, 'Programs', 'node'));
    }

    paths.push(path.join(programFiles, 'nodejs'));
    paths.push(path.join(programFilesX86, 'nodejs'));

    const nvmSymlink = processEnv.NVM_SYMLINK;
    if (nvmSymlink) paths.push(nvmSymlink);

    const nvmHome = processEnv.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path.join(appData, 'nvm'));
    }

    const voltaHome = processEnv.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    } else if (home) {
      paths.push(path.join(home, '.volta', 'bin'));
    }

    const fnmMultishell = processEnv.FNM_MULTISHELL_PATH;
    if (fnmMultishell) paths.push(fnmMultishell);

    const fnmDir = processEnv.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path.join(localAppData, 'fnm'));
    }

    const chocolateyInstall = processEnv.ChocolateyInstall;
    paths.push(chocolateyInstall ? path.join(chocolateyInstall, 'bin') : path.join(programData, 'chocolatey', 'bin'));

    const scoopDir = processEnv.SCOOP;
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

    paths.push(...getAppProvidedBinaryPaths(context));
    return paths;
  }

  const paths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
  ];

  const voltaHome = processEnv.VOLTA_HOME;
  if (voltaHome) paths.push(path.join(voltaHome, 'bin'));

  const asdfRoot = processEnv.ASDF_DATA_DIR || processEnv.ASDF_DIR;
  if (asdfRoot) {
    paths.push(path.join(asdfRoot, 'shims'));
    paths.push(path.join(asdfRoot, 'bin'));
  }

  const fnmMultishell = processEnv.FNM_MULTISHELL_PATH;
  if (fnmMultishell) paths.push(fnmMultishell);

  if (home) {
    paths.push(path.join(home, '.local', 'bin'));
    paths.push(path.join(home, '.bun', 'bin'));
    paths.push(path.join(home, '.docker', 'bin'));
    paths.push(path.join(home, '.volta', 'bin'));
    paths.push(path.join(home, '.asdf', 'shims'));
    paths.push(path.join(home, '.asdf', 'bin'));
    paths.push(path.join(home, '.fnm'));

    const nvmBin = processEnv.NVM_BIN;
    if (nvmBin) {
      paths.push(nvmBin);
    } else {
      const nvmDefault = resolveNvmDefaultBin(home, processEnv);
      if (nvmDefault) paths.push(nvmDefault);
    }
  }

  paths.push(...getAppProvidedBinaryPaths(context));
  return paths;
}

function collectBinarySearchPaths(
  additionalPaths: string | undefined,
  context: SkillsEnvironmentContext,
): string[] {
  const currentPath = context.processEnv.PATH || '';
  const additionalDirs = additionalPaths ? parsePathEntries(additionalPaths, context) : [];
  const pathDirs = parsePathEntries(currentPath, context);
  const searchPaths = getExtraBinaryPaths(context);
  return [...additionalDirs, ...pathDirs, ...searchPaths];
}

function findExecutableInSearchPaths(
  executableName: string,
  additionalPaths: string | undefined,
  context: SkillsEnvironmentContext,
): string | null {
  for (const dir of collectBinarySearchPaths(additionalPaths, context)) {
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

function findNodeDirectory(additionalPaths: string | undefined, context: SkillsEnvironmentContext): string | null {
  for (const dir of collectBinarySearchPaths(additionalPaths, context)) {
    if (!dir) continue;
    try {
      const nodePath = path.join(dir, context.nodeExecutable);
      if (fs.existsSync(nodePath) && fs.statSync(nodePath).isFile()) {
        return dir;
      }
    } catch {
      // Inaccessible directory
    }
  }

  return null;
}

function findNodeExecutableInSearchPaths(additionalPaths: string | undefined, context: SkillsEnvironmentContext): string | null {
  const nodeDir = findNodeDirectory(additionalPaths, context);
  return nodeDir ? path.join(nodeDir, context.nodeExecutable) : null;
}

export function findNodeExecutable(
  additionalPaths?: string,
  processEnv: SkillsProcessEnv = process.env,
  options?: SkillsEnvironmentOptions,
): string {
  const context = createSkillsEnvironmentContext(processEnv, options);
  return findNodeExecutableInSearchPaths(additionalPaths, context) ?? context.nodeExecutable;
}

export function findNpxExecutable(
  additionalPaths?: string,
  processEnv: SkillsProcessEnv = process.env,
  options?: SkillsEnvironmentOptions,
): string | null {
  const context = createSkillsEnvironmentContext(processEnv, options);
  const nodeExecutable = findNodeExecutableInSearchPaths(additionalPaths, context);
  if (nodeExecutable) {
    const sibling = path.join(path.dirname(nodeExecutable), context.npxExecutable);
    try {
      if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) {
        return sibling;
      }
    } catch {
      // fall through to PATH search
    }
  }

  return findExecutableInSearchPaths(context.npxExecutable, additionalPaths, context);
}

function getEnhancedPath(additionalPaths: string | undefined, context: SkillsEnvironmentContext): string {
  const extraPaths = getExtraBinaryPaths(context).filter(p => p);
  const currentPath = context.processEnv.PATH || '';

  const segments: string[] = [];

  if (additionalPaths) {
    segments.push(...parsePathEntries(additionalPaths, context));
  }

  if (currentPath) {
    segments.push(...parsePathEntries(currentPath, context));
  }

  segments.push(...extraPaths);

  const seen = new Set<string>();
  const unique = segments.filter(p => {
    const normalized = context.isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return unique.join(context.pathSeparator);
}

export function getSpawnEnvWithEnhancedPath(
  additionalPaths?: string,
  processEnv: NodeJS.ProcessEnv = process.env,
  options?: SkillsEnvironmentOptions,
): NodeJS.ProcessEnv {
  const context = createSkillsEnvironmentContext(processEnv, options);
  const pathValue = getEnhancedPath(additionalPaths, context);
  if (context.isWindows) {
    return { ...processEnv, PATH: pathValue, Path: pathValue };
  }
  return { ...processEnv, PATH: pathValue };
}

const NPX_NOT_FOUND_MESSAGE =
  'Could not find npx. Install Node.js (https://nodejs.org) or add npx to PATH. '
  + 'Obsidian runs with a minimal PATH; Pivi searches Homebrew, nvm, and other common locations.';

export function formatNpxNotFoundError(
  processEnv: SkillsProcessEnv = process.env,
  options?: SkillsEnvironmentOptions,
): string {
  const context = createSkillsEnvironmentContext(processEnv, options);
  const nodeDir = findNodeDirectory(undefined, context);
  if (nodeDir) {
    return `${NPX_NOT_FOUND_MESSAGE} Found node in ${nodeDir} but not npx alongside it.`;
  }
  return NPX_NOT_FOUND_MESSAGE;
}
