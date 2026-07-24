/**
 * Obsidian-safe replacement for pi-coding-agent/dist/config.js.
 * The upstream module uses import.meta.url at top level, which breaks when esbuild
 * bundles the package into Pivi's CJS main.js.
 */
import { homedir } from 'os';
import { join } from 'path';

export const isBunBinary = false;
export const isBunRuntime = false;
export const CONFIG_DIR_NAME = '.pi';
export const VERSION = '0.82.0';
export const APP_NAME = 'pi';
export const PACKAGE_NAME = '@earendil-works/pi-coding-agent';
export const ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR';
export const ENV_SESSION_DIR = 'PI_CODING_AGENT_SESSION_DIR';


export interface PiCodingAgentConfigHost {
  getEnvironmentVariable(name: string): string | undefined;
  getHomeDirectory(): string;
  joinPath(...segments: string[]): string;
}

const defaultConfigHost: PiCodingAgentConfigHost = {
  getEnvironmentVariable: (name) => process.env[name],
  getHomeDirectory: homedir,
  joinPath: join,
};

let configHost: PiCodingAgentConfigHost = defaultConfigHost;

export function configurePiCodingAgentConfigHost(host: Partial<PiCodingAgentConfigHost>): void {
  configHost = { ...defaultConfigHost, ...host };
}

export function resetPiCodingAgentConfigHost(): void {
  configHost = defaultConfigHost;
}
export function getAgentDir(): string {
  const envDir = configHost.getEnvironmentVariable(ENV_AGENT_DIR);
  if (envDir) {
    return envDir;
  }
  return configHost.joinPath(configHost.getHomeDirectory(), CONFIG_DIR_NAME, 'agent');
}

export function getSessionsDir(): string {
  return configHost.joinPath(getAgentDir(), 'sessions');
}

export function getBinDir(): string {
  return configHost.joinPath(getAgentDir(), 'bin');
}
