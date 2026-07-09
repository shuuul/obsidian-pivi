import {
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Setting } from 'obsidian';

import { t } from '@/i18n';

import type { PiviSettingsTabRenderContext } from '../piviSettingsTabs';

function parseBashAllowlist(value: string): string[] {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const command = line.trim();
    if (!command || seen.has(command)) {
      continue;
    }
    seen.add(command);
    commands.push(command);
  }
  return commands;
}

async function setBashAllowlist(
  ctx: PiviSettingsTabRenderContext,
  allowlist: string[],
): Promise<void> {
  const agentSettings = ctx.plugin.settings.agentSettings;
  const current = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  if (current.bashAllowlist.length === allowlist.length && current.bashAllowlist.every((value, index) => value === allowlist[index])) {
    return;
  }
  agentSettings.obsidianTools = {
    ...current,
    bashAllowlist: allowlist,
  };
  await ctx.plugin.saveSettings();
  await ctx.restartServiceForPromptChange();
  ctx.redisplayPreservingScroll();
}

export function renderBashSettingsSection(
  ctx: PiviSettingsTabRenderContext,
  container: HTMLElement,
): void {
  const settings = getObsidianToolsSettingsFromBag(ctx.plugin.settings);
  new Setting(container).setName(t('settings.bash.heading')).setHeading();

  new Setting(container)
    .setName(t('settings.bash.allowlist.name'))
    .setDesc(t('settings.bash.allowlist.desc'))
    .addTextArea((text) => {
      text
        .setPlaceholder('')
        .setValue(settings.bashAllowlist.join('\n'));
      text.inputEl.rows = 4;
      text.inputEl.cols = 40;
      text.inputEl.addEventListener('blur', () => {
        void setBashAllowlist(ctx, parseBashAllowlist(text.inputEl.value));
      });
    });
}
