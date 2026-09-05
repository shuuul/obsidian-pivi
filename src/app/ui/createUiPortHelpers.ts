import type { ChatSettingsSnapshot } from '@pivi/agent/runtime/chatPorts';
import { parseEnvironmentVariables } from '@pivi/agent/settings/environmentText';
import { getObsidianToolsSettingsFromBag } from '@pivi/agent/settings/types';
import {
  canonicalizeBashPermissions,
  canonicalizeExternalDirectories,
  defaultCaseInsensitiveExecutables,
  type PersistentBashPermission,
} from '@pivi/agent/tools';
import type { SettingsSubagentsSnapshot } from '@pivi/pivi-react/settings';

import type {
  PiviChatCompositionHost,
  PiviPluginWorkspace,
  PiviSettingsHost,
} from '@/app/hostContracts';
import { isPathWithinVault } from '@/app/hostPlatform';

import { validateDirectoryPath } from './externalDirectory';

/** Chat/settings ports take an explicit workspace; throw when composition has not wired one. */
export function requireWorkspace(workspace: PiviPluginWorkspace | null): PiviPluginWorkspace {
  if (!workspace) {
    throw new Error('Pivi workspace services are not initialized.');
  }
  return workspace;
}

export function removeEnvVar(envStr: string, name: string): string {
  const env = parseEnvironmentVariables(envStr);
  if (!(name in env)) {
    return envStr;
  }
  delete env[name];
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function normalizeMaxConcurrentSubagents(
  value: number,
): SettingsSubagentsSnapshot['maxConcurrentSubagents'] {
  switch (value) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 8:
      return value;
    default:
      return 2;
  }
}

export async function appendBashPermissions(
  host: PiviChatCompositionHost,
  permissions: readonly PersistentBashPermission[],
): Promise<void> {
  if (permissions.length === 0) {
    return;
  }
  const current = getObsidianToolsSettingsFromBag(host.settings);
  host.settings.agentSettings.obsidianTools = {
    ...current,
    bashPermissions: canonicalizeBashPermissions(
      [...current.bashPermissions, ...permissions],
      defaultCaseInsensitiveExecutables(),
    ),
    bashAllowlist: [],
  };
  await host.saveSettings();
  for (const view of host.getAllViews()) {
    await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
  }
}

export async function appendExternalReadDirectory(
  host: PiviChatCompositionHost,
  directory: string,
): Promise<void> {
  const vaultPath = host.getVaultPath();
  if (vaultPath && isPathWithinVault(directory, vaultPath)) {
    return;
  }
  const validation = validateDirectoryPath(directory);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid external directory.');
  }
  const current = getObsidianToolsSettingsFromBag(host.settings);
  const externalReadDirectories = [
    ...new Set([...(current.externalReadDirectories ?? []), directory]),
  ];
  host.settings.agentSettings.obsidianTools = {
    ...current,
    externalReadDirectories,
    externalDirectoryPermissions: canonicalizeExternalDirectories([
      ...current.externalDirectoryPermissions,
      { realpath: directory, enabled: true },
    ]),
  };
  await host.saveSettings();
  for (const view of host.getAllViews()) {
    await view.getChatHandle()?.maintenance.refreshRuntimePrompt();
    view.getChatHandle()?.maintenance.syncExternalReadDirectories(externalReadDirectories);
  }
}

export function cloneChatCustomProviders(
  providers: ChatSettingsSnapshot['modelCatalog']['customProviders'],
): ChatSettingsSnapshot['modelCatalog']['customProviders'] {
  return providers.map((provider) => ({
    ...provider,
    ...(provider.headers ? { headers: { ...provider.headers } } : {}),
    models: provider.models.map((model) => ({ ...model })),
  }));
}

export function invalidateSlashCatalog(host: PiviSettingsHost): void {
  for (const view of host.getAllViews()) view.getChatHandle()?.maintenance.invalidateSlashCatalog();
}
