/**
 * Obsidian-safe replacement for pi-coding-agent/dist/config.js.
 * The upstream module uses import.meta.url at top level, which breaks when esbuild
 * bundles the package into Obsius's CJS main.js.
 */
import { homedir } from 'os';
import { join } from 'path';

export const isBunBinary = false;
export const isBunRuntime = false;
export const CONFIG_DIR_NAME = '.pi';
export const VERSION = '0.75.5';
export const APP_NAME = 'pi';
export const PACKAGE_NAME = '@earendil-works/pi-coding-agent';
export const ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR';
export const ENV_SESSION_DIR = 'PI_CODING_AGENT_SESSION_DIR';

export function getAgentDir(): string {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    return envDir;
  }
  return join(homedir(), CONFIG_DIR_NAME, 'agent');
}

export function getSessionsDir(): string {
  return join(getAgentDir(), 'sessions');
}

export function getBinDir(): string {
  return join(getAgentDir(), 'bin');
}
