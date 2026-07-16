import { PluginLogger } from '../../foundation/pluginLogger';
import type { PiviSettings } from '../../foundation/settings';
import type { HttpClient, ProcessRunner } from '../../ports';
import {
  DEFAULT_VAULT_SKILLS_SLUG,
} from './defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from './fetchDefaultVaultSkillsRemoteSha';
import { loadVaultSkills } from './loadVaultSkills';
import { notifyVaultSkillsChanged, type VaultSkillsChangeNotifier } from './notifyVaultSkillsChanged';
import { VaultSkillsService } from './vaultSkillsService';

const logger = new PluginLogger('DefaultVaultSkills');

interface VaultPathApp {
  vault: {
    adapter?: unknown;
  };
}
interface VaultSkillsNotice {
  hide(): void;
}

export interface DefaultVaultSkillsPromptActions {
  onInstall: () => void;
  onDismiss: () => void;
}

export interface DefaultVaultSkillsContext {
  app: VaultPathApp;
  settings: Pick<
    PiviSettings,
    | 'defaultVaultSkillsSeeded'
    | 'defaultVaultSkillsPromptDismissed'
    | 'defaultVaultSkillsCommitSha'
  >;
  saveSettings(): Promise<void>;
  refreshVaultSkills: VaultSkillsChangeNotifier['refreshVaultSkills'];
  notify?(message: string, timeout?: number): VaultSkillsNotice | null;
  showDefaultVaultSkillsInstallPrompt?: (
    actions: DefaultVaultSkillsPromptActions,
  ) => VaultSkillsNotice | null;
  httpClient: HttpClient;
  processRunner: ProcessRunner;
}

function getVaultPath(app: VaultPathApp): string | null {
  const basePath = (app.vault.adapter as { basePath?: unknown } | undefined)?.basePath;
  return typeof basePath === 'string' ? basePath : null;
}

export function shouldSeedDefaultVaultSkills(
  settings: {
    defaultVaultSkillsSeeded?: boolean;
    defaultVaultSkillsPromptDismissed?: boolean;
  },
  installedSkillCount: number,
): boolean {
  if (settings.defaultVaultSkillsSeeded === true) {
    return false;
  }
  if (settings.defaultVaultSkillsPromptDismissed === true) {
    return false;
  }
  return installedSkillCount === 0;
}

export function shouldUpgradeDefaultVaultSkills(
  settings: {
    defaultVaultSkillsSeeded?: boolean;
    defaultVaultSkillsCommitSha?: string;
  },
  remoteSha: string,
): boolean {
  if (settings.defaultVaultSkillsSeeded !== true) {
    return false;
  }
  return settings.defaultVaultSkillsCommitSha !== remoteSha;
}

let defaultSkillsPromptVisible = false;

async function rememberDefaultSkillsPromptDismissed(plugin: DefaultVaultSkillsContext): Promise<void> {
  plugin.settings.defaultVaultSkillsPromptDismissed = true;
  await plugin.saveSettings();
}

export async function installDefaultVaultSkills(plugin: DefaultVaultSkillsContext): Promise<string[]> {
  const vaultPath = getVaultPath(plugin.app);
  if (!vaultPath) {
    throw new Error('Open a vault to install default Obsidian skills.');
  }

  const service = new VaultSkillsService(vaultPath, { processRunner: plugin.processRunner });
  const notice = plugin.notify?.('Installing default Obsidian skills…', 0) ?? null;
  try {
    const [remoteSha, installed] = await Promise.all([
      fetchDefaultVaultSkillsRemoteSha(plugin.httpClient),
      service.installFromSlug(DEFAULT_VAULT_SKILLS_SLUG),
    ]);
    plugin.settings.defaultVaultSkillsSeeded = true;
    delete plugin.settings.defaultVaultSkillsPromptDismissed;
    if (remoteSha) {
      plugin.settings.defaultVaultSkillsCommitSha = remoteSha;
    }
    await plugin.saveSettings();
    await notifyVaultSkillsChanged(plugin);
    notice?.hide();
    plugin.notify?.(
      `Installed default Obsidian skills (${installed.length}).`,
      5000,
    );
    return installed;
  } catch (error) {
    notice?.hide();
    const message = error instanceof Error ? error.message : String(error);
    plugin.notify?.(`Default skills install failed: ${message}`, 8000);
    throw error;
  }
}

function showDefaultVaultSkillsInstallPrompt(plugin: DefaultVaultSkillsContext): void {
  const showPrompt = plugin.showDefaultVaultSkillsInstallPrompt;
  if (defaultSkillsPromptVisible || !showPrompt) {
    return;
  }
  defaultSkillsPromptVisible = true;

  let notice: VaultSkillsNotice | null = null;
  const closeNotice = (): void => {
    defaultSkillsPromptVisible = false;
    notice?.hide();
    notice = null;
  };
  notice = showPrompt({
    onInstall() {
      closeNotice();
      void installDefaultVaultSkills(plugin).catch(() => {
        // installDefaultVaultSkills already surfaces the failure to the user.
      });
    },
    onDismiss() {
      closeNotice();
      void rememberDefaultSkillsPromptDismissed(plugin).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to save default skills prompt dismissal', message);
      });
    },
  });
  if (!notice) {
    defaultSkillsPromptVisible = false;
  }
}

/**
 * First-time default skills setup is opt-in. Startup may show a confirmation
 * prompt, but installing/updating skills only happens after a user action.
 */
export function ensureDefaultVaultSkills(plugin: DefaultVaultSkillsContext): Promise<void> {
  return Promise.resolve().then(() => {
    const vaultPath = getVaultPath(plugin.app);
    if (!vaultPath) {
      return;
    }

    const installedSkillCount = loadVaultSkills(vaultPath, { includeDisabled: true }).skills.length;
    if (shouldSeedDefaultVaultSkills(plugin.settings, installedSkillCount)) {
      showDefaultVaultSkillsInstallPrompt(plugin);
    }
  });
}
