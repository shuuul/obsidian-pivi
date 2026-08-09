import { Platform } from 'obsidian';

export type PiviHostPlatform = 'desktop' | 'mobile';

/** Host authorities that must be absent from Mobile composition. */
export interface PiviPlatformCapabilities {
  readonly platform: PiviHostPlatform;
  readonly processExecution: boolean;
  readonly externalFileAccess: boolean;
  readonly officialObsidianCli: boolean;
  readonly stdioMcp: boolean;
  readonly systemEnvironment: boolean;
  readonly localNetwork: boolean;
}

export const DESKTOP_PLATFORM_CAPABILITIES: PiviPlatformCapabilities = {
  platform: 'desktop',
  processExecution: true,
  externalFileAccess: true,
  officialObsidianCli: true,
  stdioMcp: true,
  systemEnvironment: true,
  localNetwork: true,
};

export const MOBILE_PLATFORM_CAPABILITIES: PiviPlatformCapabilities = {
  platform: 'mobile',
  processExecution: false,
  externalFileAccess: false,
  officialObsidianCli: false,
  stdioMcp: false,
  systemEnvironment: false,
  localNetwork: false,
};

export function resolvePiviPlatformCapabilities(
  isMobileApp = Platform.isMobileApp,
): PiviPlatformCapabilities {
  return isMobileApp
    ? MOBILE_PLATFORM_CAPABILITIES
    : DESKTOP_PLATFORM_CAPABILITIES;
}
