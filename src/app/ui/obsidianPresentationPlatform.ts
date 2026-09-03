import type { HostTerminology, Locale, PresentationPlatform } from '@pivi/pivi-react';
import { setIcon, setTooltip } from 'obsidian';

const terminology: Record<Locale, HostTerminology> = {
  en: { hostName: 'Obsidian', workspaceName: 'vault', workspaceNameTitle: 'Vault', secureStorageName: 'Obsidian keychain' },
  'zh-CN': { hostName: 'Obsidian', workspaceName: '库', workspaceNameTitle: '库', secureStorageName: 'Obsidian 钥匙串' },
  'zh-TW': { hostName: 'Obsidian', workspaceName: '庫', workspaceNameTitle: '庫', secureStorageName: 'Obsidian 鑰匙圈' },
  ja: { hostName: 'Obsidian', workspaceName: 'Vault', workspaceNameTitle: 'Vault', secureStorageName: 'Obsidian キーチェーン' },
  ko: { hostName: 'Obsidian', workspaceName: 'Vault', workspaceNameTitle: 'Vault', secureStorageName: 'Obsidian 키체인' },
  de: { hostName: 'Obsidian', workspaceName: 'Vault', workspaceNameTitle: 'Vault', secureStorageName: 'Obsidian-Schlüsselbund' },
  fr: { hostName: 'Obsidian', workspaceName: 'coffre', workspaceNameTitle: 'Coffre', secureStorageName: 'trousseau Obsidian' },
  es: { hostName: 'Obsidian', workspaceName: 'bóveda', workspaceNameTitle: 'Bóveda', secureStorageName: 'llavero de Obsidian' },
  ru: { hostName: 'Obsidian', workspaceName: 'хранилище', workspaceNameTitle: 'Хранилище', secureStorageName: 'связка ключей Obsidian' },
  pt: { hostName: 'Obsidian', workspaceName: 'cofre', workspaceNameTitle: 'Cofre', secureStorageName: 'chaveiro do Obsidian' },
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
