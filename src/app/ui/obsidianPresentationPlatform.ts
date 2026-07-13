import type { HostTerminology, Locale, PresentationPlatform } from '@pivi/pivi-react';
import { setIcon, setTooltip } from 'obsidian';

const terminology: Record<Locale, HostTerminology> = {
  en: { hostName: 'Obsidian', workspaceName: 'vault', secureStorageName: 'Obsidian keychain' },
  'zh-CN': { hostName: 'Obsidian', workspaceName: '库', secureStorageName: 'Obsidian 钥匙串' },
  'zh-TW': { hostName: 'Obsidian', workspaceName: '庫', secureStorageName: 'Obsidian 鑰匙圈' },
  ja: { hostName: 'Obsidian', workspaceName: 'Vault', secureStorageName: 'Obsidian キーチェーン' },
  ko: { hostName: 'Obsidian', workspaceName: 'Vault', secureStorageName: 'Obsidian 키체인' },
  de: { hostName: 'Obsidian', workspaceName: 'Vault', secureStorageName: 'Obsidian-Schlüsselbund' },
  fr: { hostName: 'Obsidian', workspaceName: 'coffre', secureStorageName: 'trousseau Obsidian' },
  es: { hostName: 'Obsidian', workspaceName: 'bóveda', secureStorageName: 'llavero de Obsidian' },
  ru: { hostName: 'Obsidian', workspaceName: 'хранилище', secureStorageName: 'связка ключей Obsidian' },
  pt: { hostName: 'Obsidian', workspaceName: 'cofre', secureStorageName: 'chaveiro do Obsidian' },
};

export const obsidianPresentationPlatform: PresentationPlatform = {
  getTerminology(locale) {
    return terminology[locale];
  },
  renderIcon(container, name) {
    setIcon(container, name);
  },
  attachTooltip(container, label, options) {
    setTooltip(container, label, options);
  },
};
