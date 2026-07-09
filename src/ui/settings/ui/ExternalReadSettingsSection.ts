import { normalizePathForFilesystem } from '@pivi/obsidian-host/path';
import {
  getObsidianToolsSettingsFromBag,
  resolveObsidianToolsSettings,
} from '@pivi/pivi-agent-core/foundation/settings';
import { Notice, Setting, type TextAreaComponent } from 'obsidian';
import * as path from 'path';

import type { PiviPluginHost as PiviPlugin } from '@/app/PiviPluginHost';
import { t } from '@/i18n';
import {
  findConflictingPath,
  isDuplicatePath,
  validateDirectoryPath,
} from '@/ui/shared/utils/externalContext';
import { pickDirectoryPath } from '@/ui/shared/utils/folderPicker';

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
    new Notice(t('settings.externalRead.needDirectory'));
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
      return { directories: [], error: t('settings.externalRead.pathMustBeAbsolute', { path: raw }) };
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
          ? t('settings.externalRead.insideAllowed', { path: normalized, other: conflict.path })
          : t('settings.externalRead.containsAllowed', { path: normalized, other: conflict.path }),
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

function commitTextAreaDirectories(
  options: ExternalReadSettingsSectionOptions,
  text: TextAreaComponent,
): void {
  const parsed = parseExternalReadDirectoriesInput(text.inputEl.value);
  if (parsed.error) {
    new Notice(t('settings.externalRead.notSaved', { error: parsed.error }));
    text.setValue(
      getObsidianToolsSettingsFromBag(options.plugin.settings).externalReadDirectories.join('\n'),
    );
    return;
  }
  void setExternalReadDirectories(options, parsed.directories);
}

async function browseAndAppendDirectory(
  options: ExternalReadSettingsSectionOptions,
  text: TextAreaComponent,
): Promise<void> {
  try {
    const selectedPath = await pickDirectoryPath({
      title: t('settings.externalRead.directories.pickerTitle'),
      hostWindow: options.container.ownerDocument.defaultView ?? activeWindow,
    });
    if (!selectedPath) {
      return;
    }

    const normalized = normalizePathForFilesystem(selectedPath);
    if (!normalized || !path.isAbsolute(normalized)) {
      new Notice(
        t('settings.externalRead.notSaved', {
          error: t('settings.externalRead.pathMustBeAbsolute', { path: selectedPath }),
        }),
      );
      return;
    }

    const currentValue = text.inputEl.value;
    const currentParsed = parseExternalReadDirectoriesInput(currentValue);
    // If the textarea is already invalid, fall back to saved settings as the base list.
    const baseDirectories = currentParsed.error
      ? getObsidianToolsSettingsFromBag(options.plugin.settings).externalReadDirectories
      : currentParsed.directories;

    if (isDuplicatePath(normalized, baseDirectories)) {
      new Notice(t('settings.externalRead.directories.alreadyAdded'), 3000);
      return;
    }

    const conflict = findConflictingPath(normalized, baseDirectories);
    if (conflict) {
      const error = conflict.type === 'parent'
        ? t('settings.externalRead.insideAllowed', { path: normalized, other: conflict.path })
        : t('settings.externalRead.containsAllowed', { path: normalized, other: conflict.path });
      new Notice(t('settings.externalRead.notSaved', { error }), 5000);
      return;
    }

    const validation = validateDirectoryPath(normalized);
    if (!validation.valid) {
      new Notice(
        t('settings.externalRead.notSaved', {
          error: `${validation.error}: ${normalized}`,
        }),
      );
      return;
    }

    const nextDirectories = [...baseDirectories, normalized];
    text.setValue(nextDirectories.join('\n'));
    await setExternalReadDirectories(options, nextDirectories);
  } catch {
    new Notice(t('settings.externalRead.directories.pickerFailed'), 5000);
  }
}

export function renderExternalReadSettingsSection(
  options: ExternalReadSettingsSectionOptions,
): void {
  const { container, plugin } = options;
  new Setting(container).setName(t('settings.externalRead.heading')).setHeading();

  const settings = getObsidianToolsSettingsFromBag(plugin.settings);
  new Setting(container)
    .setName(t('settings.externalRead.allow.name'))
    .setDesc(t('settings.externalRead.allow.desc'))
    .addToggle((toggle) => {
      toggle
        .setValue(settings.allowExternalRead)
        .onChange(async (value) => {
          await setExternalReadAllowed(options, value);
        });
    });

  let directoriesText: TextAreaComponent | null = null;
  new Setting(container)
    .setName(t('settings.externalRead.directories.name'))
    .setDesc(t('settings.externalRead.directories.desc'))
    .addTextArea((text) => {
      directoriesText = text;
      text
        .setPlaceholder(t('settings.externalRead.directories.placeholder'))
        .setValue(settings.externalReadDirectories.join('\n'));
      text.inputEl.rows = 4;
      text.inputEl.cols = 40;
      text.inputEl.addClass('pivi-settings-external-dirs-textarea');
      text.inputEl.addEventListener('blur', () => {
        commitTextAreaDirectories(options, text);
      });
    })
    .addButton((button) => {
      button
        .setButtonText(t('settings.externalRead.directories.browse'))
        .setTooltip(t('settings.externalRead.directories.browseTooltip'))
        .onClick(() => {
          if (!directoriesText) {
            return;
          }
          void browseAndAppendDirectory(options, directoriesText);
        });
    });
}
