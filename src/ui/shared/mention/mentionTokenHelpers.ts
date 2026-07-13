import {
  canUseWikilinkAlias,
  findMatchedAlias,
  formatVaultFileMentionToken,
  getPreferredAlias,
  normalizeAliases,
} from '@pivi/obsidian-ui';

import type { MentionItem } from './types';

export {
  canUseWikilinkAlias,
  findMatchedAlias,
  formatVaultFileMentionToken,
  getPreferredAlias,
  normalizeAliases,
};

export const DEFAULT_MENTION_DROPDOWN_MAX_WIDTH = 320;
export const EXPANDED_MENTION_DROPDOWN_MAX_WIDTH = 480;
export const MIN_MENTION_DROPDOWN_WIDTH = 180;
export const ESTIMATED_MENTION_TEXT_CHAR_WIDTH = 7;
export const MENTION_DROPDOWN_HORIZONTAL_CHROME = 52;

export function getMentionItemWidthText(item: MentionItem): string {
  switch (item.type) {
    case 'file': {
      const alias = getPreferredAlias(item.aliases, item.matchedAlias);
      return alias ? `${alias} ${item.path}` : item.path;
    }
    case 'folder':
      return item.path;
    case 'context-folder':
      return item.name;
    case 'agent':
      return `${item.id} ${item.description ?? ''}`;
    case 'agent-folder':
      return item.name;
  }
}
