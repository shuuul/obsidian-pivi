import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';
import {
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Notice, Setting } from 'obsidian';
import * as path from 'path';

import type { PiviPluginHost as PiviPlugin } from '@/app/PiviPluginHost';
import {
  findConflictingPath,
  isDuplicatePath,
  validateDirectoryPath,
} from '@/ui/shared/utils/externalContext';

export interface ExternalReadSettingsSectionOptions {
  container: HTMLElement;
  plugin: PiviPlugin;
  restartServiceForPromptChange: () => Promise<void>;
  onSettingsChanged?: () => void;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function setExternalReadAllowed(
  options: ExternalReadSettingsSectionOptions,
  allowed: boolean,
): Promise<void> {
  const agentSettings = options.plugin.settings.agentSettings;
  const current = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  agentSettings.obsidianTools = {
    ...current,
    allowExternalRead: allowed,
  };
  await options.plugin.saveSettings();
  await options.restartServiceForPromptChange();
  if (allowed && current.externalReadDirectories.length === 0) {
    new Notice('Add at least one allowed external directory before external read tools become available.');
  }
  options.onSettingsChanged?.();
}

function stripPathQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseExternalReadDirectoriesInput(value: string): { directories: string[]; error?: string } {
  const directories: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const raw = stripPathQuotes(line.trim());
    if (!raw) {
      continue;
    }
    const normalized = normalizePathForFilesystem(raw);
    if (!normalized || !path.isAbsolute(normalized)) {
      return { directories: [], error: `Path must be absolute: ${raw}` };
    }
    const validation = validateDirectoryPath(normalized);
    if (!validation.valid) {
      return { directories: [], error: `${validation.error}: ${normalized}` };
    }
    if (isDuplicatePath(normalized, directories)) {
      continue;
    }
    const conflict = findConflictingPath(normalized, directories);
    if (conflict) {
      return {
        directories: [],
        error: conflict.type === 'parent'
          ? `${normalized} is inside already allowed directory ${conflict.path}`
          : `${normalized} contains already allowed directory ${conflict.path}`,
      };
    }
    directories.push(normalized);
  }
  return { directories };
}

async function setExternalReadDirectories(
  options: ExternalReadSettingsSectionOptions,
  directories: string[],
): Promise<void> {
  const agentSettings = options.plugin.settings.agentSettings;
  const current = resolveObsidianToolsSettings(agentSettings.obsidianTools);
  if (arraysEqual(current.externalReadDirectories, directories)) {
    return;
  }
  agentSettings.obsidianTools = {
    ...current,
    externalReadDirectories: directories,
  };
  await options.plugin.saveSettings();
  await options.restartServiceForPromptChange();
  options.onSettingsChanged?.();
}

export function renderExternalReadSettingsSection(
  options: ExternalReadSettingsSectionOptions,
): void {
  const { container, plugin } = options;
  new Setting(container).setName('External filesystem access').setHeading();

  const settings = getObsidianToolsSettingsFromBag(plugin.settings);
  new Setting(container)
    .setName('Allow external file read/list')
    .setDesc('Allows Pivi to read and list files under the allowed external directories below, plus external context folders selected for the current chat session.')
    .addToggle((toggle) => {
      toggle
        .setValue(settings.allowExternalRead)
        .onChange(async (value) => {
          await setExternalReadAllowed(options, value);
        });
    });

  new Setting(container)
    .setName('Allowed external directories')
    .setDesc('One absolute directory per line. Pivi can only read/list paths inside these directories when external read is enabled.')
    .addTextArea((text) => {
      text
        .setPlaceholder('/users/me/workspace\n/users/me/research')
        .setValue(settings.externalReadDirectories.join('\n'));
      text.inputEl.rows = 4;
      text.inputEl.cols = 40;
      text.inputEl.addEventListener('blur', () => {
        const parsed = parseExternalReadDirectoriesInput(text.inputEl.value);
        if (parsed.error) {
          new Notice(`External read directories not saved: ${parsed.error}`);
          text.setValue(getObsidianToolsSettingsFromBag(plugin.settings).externalReadDirectories.join('\n'));
          return;
        }
        void setExternalReadDirectories(options, parsed.directories);
      });
    });
}
