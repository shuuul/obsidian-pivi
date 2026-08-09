import * as path from 'path';

import type { McpProcessEnv } from './ports';


const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';

function parsePathEntries(value: string): string[] {
  return value.split(PATH_SEPARATOR).map((entry) => entry.trim()).filter(Boolean);
}

function getHomeDir(processEnv: McpProcessEnv): string {
  return processEnv.HOME || processEnv.USERPROFILE || '';
}

function getExtraBinaryPaths(processEnv: McpProcessEnv): string[] {
  const home = getHomeDir(processEnv);
  if (isWindows) {
    const appData = processEnv.APPDATA;
    const localAppData = processEnv.LOCALAPPDATA;
    return [
      appData ? path.join(appData, 'npm') : '',
      localAppData ? path.join(localAppData, 'Programs', 'nodejs') : '',
      processEnv.NVM_SYMLINK ?? '',
      processEnv.NVM_HOME ?? '',
      processEnv.VOLTA_HOME ? path.join(processEnv.VOLTA_HOME, 'bin') : '',
      home ? path.join(home, '.volta', 'bin') : '',
      home ? path.join(home, '.local', 'bin') : '',
    ].filter(Boolean);
  }

  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    processEnv.VOLTA_HOME ? path.join(processEnv.VOLTA_HOME, 'bin') : '',
    processEnv.NVM_BIN ?? '',
    home ? path.join(home, '.local', 'bin') : '',
    home ? path.join(home, '.bun', 'bin') : '',
    home ? path.join(home, '.volta', 'bin') : '',
    home ? path.join(home, '.asdf', 'shims') : '',
  ].filter(Boolean);
}

/** PATH for MCP stdio servers from GUI apps like Obsidian, which often have a minimal PATH. */
export function getEnhancedPath(processEnv: McpProcessEnv, additionalPaths?: string): string {
  const segments = [
    ...(additionalPaths ? parsePathEntries(additionalPaths) : []),
    ...getExtraBinaryPaths(processEnv),
    ...(processEnv.PATH ? parsePathEntries(processEnv.PATH) : []),
  ];
  const seen = new Set<string>();
  return segments.filter((entry) => {
    const key = isWindows ? entry.toLowerCase() : entry;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(PATH_SEPARATOR);
}
