import * as fs from 'fs';
import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getPiProviderSettings, updatePiProviderSettings } from '../settings';

export const piSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const piSettings = getPiProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable Pi coding agent')
      .setDesc('Launch `pi --mode rpc` as a provider.')
      .addToggle((toggle) =>
        toggle
          .setValue(piSettings.enabled)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName('CLI path')
      .setDesc('Optional absolute path to the Pi CLI for this computer. Leave empty to use `pi` from PATH.');

    const validationEl = container.createDiv({
      cls: 'obsius-cli-path-validation obsius-setting-validation obsius-setting-validation-error obsius-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const expandedPath = expandHomePath(trimmed);
      try {
        if (!fs.existsSync(expandedPath)) {
          return 'Path does not exist';
        }

        const stat = fs.statSync(expandedPath);
        if (!stat.isFile()) {
          return 'Path must point to a file';
        }
      } catch {
        return 'Invalid path';
      }

      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.removeClass('obsius-hidden');
        if (inputEl) {
          inputEl.classList.add('obsius-input-error');
        }
        return false;
      }

      validationEl.addClass('obsius-hidden');
      if (inputEl) {
        inputEl.classList.remove('obsius-input-error');
      }
      return true;
    };

    const cliPathsByHost = { ...piSettings.cliPathsByHost };
    const currentValue = piSettings.cliPathsByHost[hostnameKey] || '';
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updatePiProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      return true;
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\pi.cmd'
          : '/usr/local/bin/pi')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });

      text.inputEl.addClass('obsius-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container)
      .setName('Environment variables')
      .setDesc('Extra environment variables passed to Pi.')
      .addTextArea((text) =>
        text
          .setPlaceholder('Pi_enable_exa=1')
          .setValue(piSettings.environmentVariables)
          .onChange(async (value) => {
            updatePiProviderSettings(settingsBag, { environmentVariables: value });
            await context.plugin.saveSettings();
          })
      );
  },
};
