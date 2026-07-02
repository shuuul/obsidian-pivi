import * as path from 'path';

const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';

function parsePathEntries(value: string): string[] {
  return value.split(PATH_SEPARATOR).map((entry) => entry.trim()).filter(Boolean);
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function getExtraBinaryPaths(): string[] {
  const home = getHomeDir();
  if (isWindows) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    return [
      appData ? path.join(appData, 'npm') : '',
      localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
      process.env.NVM_SYMLINK ?? '',
      process.env.NVM_HOME ?? '',
      process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, 'bin') : '',
      home ? path.join(home, '.volta', 'bin') : '',
      home ? path.join(home, '.local', 'bin') : '',
    ].filter(Boolean);
  }

  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    process.env.VOLTA_HOME ? path.join(process.env.VOLTA_HOME, 'bin') : '',
    process.env.NVM_BIN ?? '',
    home ? path.join(home, '.local', 'bin') : '',
    home ? path.join(home, '.bun', 'bin') : '',
    home ? path.join(home, '.volta', 'bin') : '',
    home ? path.join(home, '.asdf', 'shims') : '',
  ].filter(Boolean);
}

/** PATH for MCP stdio servers from GUI apps like Obsidian, which often have a minimal PATH. */
export function getEnhancedPath(additionalPaths?: string): string {
  const segments = [
    ...(additionalPaths ? parsePathEntries(additionalPaths) : []),
    ...getExtraBinaryPaths(),
    ...(process.env.PATH ? parsePathEntries(process.env.PATH) : []),
  ];
  const seen = new Set<string>();
  return segments.filter((entry) => {
    const key = isWindows ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(PATH_SEPARATOR);
}
