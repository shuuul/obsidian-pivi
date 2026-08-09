import type { Plugin } from 'obsidian';

import type { PiviPlatformCapabilities } from '@/app/platformCapabilities';

export async function createDesktopRuntime(
  owner: Plugin,
  capabilities: PiviPlatformCapabilities,
) {
  const { configureNodePiAiEnvironmentHost } = await import(
    '@pivi/pivi-agent-core/engine/pi/shims/piAiEnvApiKeysNode'
  );
  configureNodePiAiEnvironmentHost();

  const { patchSetMaxListenersForElectron } = await import(
    '@pivi/obsidian-host/electronCompat'
  );
  patchSetMaxListenersForElectron();

  // Desktop-only Node-backed truncated-subagent reader; Mobile never loads this leaf.
  const { configureTrustedFullOutputReader } = await import(
    '@/ui/chat/services/subagentOutput'
  );
  const { readTrustedFullOutputFileDesktop } = await import(
    '@/ui/chat/services/subagentOutputDesktop'
  );
  configureTrustedFullOutputReader(readTrustedFullOutputFileDesktop);

  const { configureExternalContextPlatform } = await import(
    '@/ui/shared/utils/externalContextPlatform'
  );
  const { desktopExternalContextPlatform } = await import(
    '@/ui/shared/utils/externalContextPlatformDesktop'
  );
  configureExternalContextPlatform(desktopExternalContextPlatform);

  const { default: PiviDesktopRuntime } = await import('./PiviDesktopRuntime');
  return new PiviDesktopRuntime(owner, capabilities);
}
