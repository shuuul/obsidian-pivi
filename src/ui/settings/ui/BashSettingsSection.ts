import {
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Notice, Setting } from 'obsidian';

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

async function setBashAllowed(
  ctx: PiviSettingsTabRenderContext,
  allowed: boolean,
): Promise<void> {
  const agentSettings = ctx.plugin.settings.agentSettings;
  const current = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  agentSettings.obsidianTools = {
    ...current,
    allowBash: allowed,
  };
  await ctx.plugin.saveSettings();
  await ctx.restartServiceForPromptChange();
  if (allowed && current.bashAllowlist.length === 0) {
    new Notice('Add at least one allowed bash command before the bash tool can run commands.');
  }
  ctx.redisplayPreservingScroll();
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
  new Setting(container).setName('Bash access').setHeading();

  new Setting(container)
    .setName('Allow bash tool')
    .setDesc('Allows Pivi to run one-line shell commands that match the allowlist below. Keep this disabled unless you trust the current agent session.')
    .addToggle((toggle) => {
      toggle
        .setValue(settings.allowBash)
        .onChange(async (value) => {
          await setBashAllowed(ctx, value);
        });
    });

  new Setting(container)
    .setName('Allowed bash commands')
    .setDesc('One command per line. A bare executable such as Git allows Git subcommands; a line with spaces such as npm run build allows that exact command prefix.')
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
