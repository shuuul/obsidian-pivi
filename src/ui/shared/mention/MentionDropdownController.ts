import type { TFile } from 'obsidian';
import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';

import { SelectableDropdown } from '../components/SelectableDropdown';
import { getActiveWindow } from '../dom';
import { buildExternalContextDisplayEntries } from '../utils/externalContext';
import { extractMcpMentions } from '../utils/mcpMentions';
import type { ComposerInput } from './composerInputTypes';
import { buildVaultMentionItems } from './mentionDropdownVaultItems';
import {
  DEFAULT_MENTION_DROPDOWN_MAX_WIDTH,
  ESTIMATED_MENTION_TEXT_CHAR_WIDTH,
  EXPANDED_MENTION_DROPDOWN_MAX_WIDTH,
  formatVaultFileMentionToken,
  getMentionItemWidthText,
  getPreferredAlias,
  MENTION_DROPDOWN_HORIZONTAL_CHROME,
  MIN_MENTION_DROPDOWN_WIDTH,
} from './mentionTokenHelpers';
import {
  type AgentMentionProvider,
  type FolderMentionItem,
  type MentionItem,
} from './types';

type MentionInputElement = ComposerInput | HTMLTextAreaElement | HTMLInputElement;

function getTextOffsetClientRect(inputEl: MentionInputElement, offset: number): DOMRect | null {
  if ('getTextOffsetClientRect' in inputEl && typeof inputEl.getTextOffsetClientRect === 'function') {
    return inputEl.getTextOffsetClientRect(offset);
  }
  return null;
}

export type { AgentMentionProvider };

export interface MentionDropdownOptions {
  fixed?: boolean;
}

export interface MentionDropdownCallbacks {
  onAttachFile: (path: string) => void;
  onMcpMentionChange?: (servers: Set<string>) => void;
  onAgentMentionSelect?: (agentId: string) => void;
  getMentionedMcpServers: () => Set<string>;
  setMentionedMcpServers: (mentions: Set<string>) => boolean;
  addMentionedMcpServer: (name: string) => void;
  getExternalContexts: () => string[];
  getCachedVaultFolders: () => Array<Pick<FolderMentionItem, 'name' | 'path'>>;
  getCachedVaultFiles: () => TFile[];
  getVaultFileAliases?: (file: TFile) => readonly string[];
  /** File path to prioritize when the user opens @ mention with an empty query. */
  getActiveVaultFilePath?: () => string | null;
  normalizePathForVault: (path: string | undefined | null) => string | null;
}

export interface McpMentionProvider {
  getContextSavingServers: () => Array<{ name: string }>;
}

export class MentionDropdownController {
  private containerEl: HTMLElement;
  private inputEl: MentionInputElement;
  private callbacks: MentionDropdownCallbacks;
  private dropdown: SelectableDropdown<MentionItem>;
  private mentionStartIndex = -1;
  private selectedMentionIndex = 0;
  private filteredMentionItems: MentionItem[] = [];
  private activeAgentFilter = false;
  private mcpManager: McpMentionProvider | null = null;
  private agentService: AgentMentionProvider | null = null;
  private fixed: boolean;
  private debounceTimer: number | null = null;

  constructor(
    containerEl: HTMLElement,
    inputEl: MentionInputElement,
    callbacks: MentionDropdownCallbacks,
    options: MentionDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.fixed = options.fixed ?? false;

    this.dropdown = new SelectableDropdown<MentionItem>(this.containerEl, {
      listClassName: 'pivi-mention-dropdown',
      itemClassName: 'pivi-mention-item',
      emptyClassName: 'pivi-mention-empty',
      fixed: this.fixed,
      fixedClassName: 'pivi-mention-dropdown-fixed',
    });
  }

  setMcpManager(manager: McpMentionProvider | null): void {
    this.mcpManager = manager;
  }

  setAgentService(service: AgentMentionProvider | null): void {
    if (this.agentService !== service && this.dropdown.isVisible()) {
      this.hide();
    }
    this.agentService = service;
  }

  isVisible(): boolean {
    return this.dropdown.isVisible();
  }

  hide(): void {
    this.dropdown.hide();
    this.containerEl.removeClass('pivi-mention-dropdown-open');
    this.mentionStartIndex = -1;
  }

  containsElement(el: Node): boolean {
    return this.dropdown.getElement()?.contains(el) ?? false;
  }

  destroy(): void {
    if (this.debounceTimer !== null) {
      getActiveWindow(this.containerEl).clearTimeout(this.debounceTimer);
    }
    this.containerEl.removeClass('pivi-mention-dropdown-open');
    this.dropdown.destroy();
  }

  updateMcpMentionsFromText(text: string): void {
    if (!this.mcpManager) return;

    const validNames = new Set(
      this.mcpManager.getContextSavingServers().map(s => s.name)
    );

    const newMentions = extractMcpMentions(text, validNames);
    const changed = this.callbacks.setMentionedMcpServers(newMentions);

    if (changed) {
      this.callbacks.onMcpMentionChange?.(newMentions);
    }
  }

  handleInputChange(): void {
    const win = getActiveWindow(this.containerEl);
    if (this.debounceTimer !== null) {
      win.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = win.setTimeout(() => {
      const text = this.inputEl.value;
      this.updateMcpMentionsFromText(text);

      const cursorPos = this.inputEl.selectionStart || 0;
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      if (lastAtIndex === -1) {
        this.hide();
        return;
      }

      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] ?? ' ' : ' ';
      if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
        this.hide();
        return;
      }

      const searchText = textBeforeCursor.substring(lastAtIndex + 1);

      if (searchText.startsWith('[') || /\s/.test(searchText)) {
        this.hide();
        return;
      }

      this.mentionStartIndex = lastAtIndex;
      this.showMentionDropdown(searchText);
    }, 200);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.dropdown.isVisible()) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.dropdown.moveSelection(1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.dropdown.moveSelection(-1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
      e.preventDefault();
      this.selectMentionItem();
      return true;
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      // If in secondary menu, return to first level instead of closing
      if (this.activeAgentFilter) {
        this.returnToFirstLevel();
        return true;
      }
      this.hide();
      return true;
    }

    return false;
  }

  private showMentionDropdown(searchText: string): void {
    const searchLower = searchText.toLowerCase();
    this.filteredMentionItems = [];

    const externalContexts = this.callbacks.getExternalContexts() || [];
    const contextEntries = buildExternalContextDisplayEntries(externalContexts);

    const isFilterSearch = searchText.includes('/');

    if (isFilterSearch && searchLower.startsWith('agents/')) {
      this.activeAgentFilter = true;
      const agentSearchText = searchText.substring('agents/'.length).toLowerCase();

      if (this.agentService) {
        const matchingAgents = this.agentService.searchAgents(agentSearchText);
        for (const agent of matchingAgents) {
          this.filteredMentionItems.push({
            type: 'agent',
            id: agent.id,
            name: agent.name,
            description: agent.description,
            source: agent.source,
          });
        }
      }

      this.selectedMentionIndex = 0;
      this.renderMentionDropdown();
      return;
    }

    this.activeAgentFilter = false;

    if (this.agentService) {
      const hasAgents = this.agentService.searchAgents('').length > 0;
      if (hasAgents && 'agents'.includes(searchLower)) {
        this.filteredMentionItems.push({
          type: 'agent-folder',
          name: t('chat.mention.agents'),
        });
      }
    }

    // External contexts: list checked roots only (no recursive file drill-down).
    if (contextEntries.length > 0) {
      const matchingFolders = new Set<string>();
      for (const entry of contextEntries) {
        if (entry.displayNameLower.includes(searchLower) && !matchingFolders.has(entry.displayName)) {
          matchingFolders.add(entry.displayName);
          this.filteredMentionItems.push({
            type: 'context-folder',
            name: entry.displayName,
            contextRoot: entry.contextRoot,
            folderName: entry.displayName,
          });
        }
      }
    }

    const firstVaultItemIndex = this.filteredMentionItems.length;
    const vaultItemCount = this.appendVaultItems(searchLower);

    this.selectedMentionIndex = vaultItemCount > 0 ? firstVaultItemIndex : 0;

    this.renderMentionDropdown();
  }

  private appendVaultItems(searchLower: string): number {
    const vaultItems = buildVaultMentionItems({
      searchLower,
      files: this.callbacks.getCachedVaultFiles(),
      folders: this.callbacks.getCachedVaultFolders(),
      getVaultFileAliases: this.callbacks.getVaultFileAliases,
      activeFilePath: this.callbacks.getActiveVaultFilePath?.() ?? null,
    });
    this.filteredMentionItems.push(...vaultItems);
    return vaultItems.length;
  }

  private renderMentionDropdown(): void {
    this.dropdown.render({
      items: this.filteredMentionItems,
      selectedIndex: this.selectedMentionIndex,
      emptyText: 'No matches',
      getItemClass: (item) => {
        switch (item.type) {
          case 'file': return 'pivi-mention-item--workspace-file';
          case 'folder': return 'pivi-mention-item--workspace-folder';
          case 'agent': return 'pivi-mention-item--agent';
          case 'agent-folder': return 'pivi-mention-item--agent-folder';
          case 'context-folder': return 'pivi-mention-item--context-folder';
        }
      },
      renderItem: (item, itemEl) => {
        const iconEl = itemEl.createSpan({ cls: 'pivi-mention-icon' });
        switch (item.type) {
          case 'agent':
          case 'agent-folder':
            setIcon(iconEl, 'bot');
            break;
          case 'folder':
            setIcon(iconEl, 'folder');
            break;
          case 'context-folder':
            setIcon(iconEl, 'database-search');
            break;
          case 'file':
            setIcon(iconEl, 'file-text');
            break;
        }

        const textEl = itemEl.createSpan({ cls: 'pivi-mention-text' });

        switch (item.type) {
          case 'agent-folder':
            textEl.createSpan({
              cls: 'pivi-mention-name pivi-mention-name-agent-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'agent': {
            // Show ID (which is namespaced for plugin agents) for consistency with inserted text
            textEl.createSpan({
              cls: 'pivi-mention-name pivi-mention-name-agent',
            }).setText(`@${item.id}`);
            if (item.description) {
              textEl.createSpan({ cls: 'pivi-mention-agent-desc' }).setText(item.description);
            }
            break;
          }
          case 'context-folder':
            textEl.createSpan({
              cls: 'pivi-mention-name pivi-mention-name-folder',
            }).setText(item.name);
            break;
          case 'folder':
            textEl.createSpan({
              cls: 'pivi-mention-name pivi-mention-name-folder',
            }).setText(`@${item.path}/`);
            break;
          case 'file': {
            const alias = getPreferredAlias(item.aliases, item.matchedAlias);
            textEl.createSpan({
              cls: alias
                ? 'pivi-mention-name pivi-mention-name-file-alias'
                : 'pivi-mention-name pivi-mention-name-file',
            }).setText(alias ?? item.name);
            textEl.createSpan({
              cls: 'pivi-mention-path pivi-mention-path-secondary',
            }).setText(item.path);
            break;
          }
        }
      },
      onItemClick: (item, index, e) => {
        // Stop propagation for folder items to prevent document click handler
        // from hiding dropdown (since dropdown is re-rendered with new DOM)
        if (item.type === 'context-folder' || item.type === 'agent-folder') {
          e.stopPropagation();
        }
        this.selectedMentionIndex = index;
        this.selectMentionItem();
      },
      onItemHover: (_item, index) => {
        this.selectedMentionIndex = index;
      },
    });
    this.containerEl.addClass('pivi-mention-dropdown-open');

    if (this.fixed) {
      this.positionFixed();
    } else {
      this.positionAnchored();
    }
  }

  private positionAnchored(): void {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    const anchorRect = getTextOffsetClientRect(this.inputEl, this.mentionStartIndex) ?? inputRect;
    const containerRect = this.containerEl.getBoundingClientRect();
    const baseWidth = Math.min(
      DEFAULT_MENTION_DROPDOWN_MAX_WIDTH,
      Math.max(MIN_MENTION_DROPDOWN_WIDTH, inputRect.width / 2),
    );
    const dropdownWidth = this.getDropdownWidth(baseWidth, Math.min(
      EXPANDED_MENTION_DROPDOWN_MAX_WIDTH,
      Math.max(baseWidth, containerRect.width * 0.75),
    ));
    const left = Math.min(
      Math.max(anchorRect.left - containerRect.left, 0),
      Math.max(0, containerRect.width - dropdownWidth),
    );
    const bottom = Math.max(0, containerRect.bottom - anchorRect.top + 4);

    dropdownEl.setCssProps({
      '--pivi-anchored-dropdown-bottom': `${bottom}px`,
      '--pivi-anchored-dropdown-left': `${left}px`,
      '--pivi-anchored-dropdown-width': `${dropdownWidth}px`,
    });
  }

  private positionFixed(): void {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    const anchorRect = getTextOffsetClientRect(this.inputEl, this.mentionStartIndex) ?? inputRect;
    const win = getActiveWindow(this.containerEl);
    const baseWidth = Math.min(
      DEFAULT_MENTION_DROPDOWN_MAX_WIDTH,
      Math.max(MIN_MENTION_DROPDOWN_WIDTH, inputRect.width / 2),
    );
    const dropdownWidth = this.getDropdownWidth(baseWidth, Math.min(
      EXPANDED_MENTION_DROPDOWN_MAX_WIDTH,
      Math.max(baseWidth, win.innerWidth * 0.75 - 32),
    ));
    const left = Math.min(
      Math.max(anchorRect.left, inputRect.left),
      Math.max(inputRect.left, inputRect.right - dropdownWidth),
    );

    dropdownEl.setCssProps({
      '--pivi-fixed-dropdown-bottom': `${win.innerHeight - anchorRect.top + 4}px`,
      '--pivi-fixed-dropdown-left': `${left}px`,
      '--pivi-fixed-dropdown-width': `${dropdownWidth}px`,
    });
  }

  private getDropdownWidth(baseWidth: number, maxWidth: number): number {
    const longestTextLength = this.filteredMentionItems.reduce(
      (maxLength, item) => Math.max(maxLength, getMentionItemWidthText(item).length),
      0,
    );
    const estimatedWidth = longestTextLength * ESTIMATED_MENTION_TEXT_CHAR_WIDTH
      + MENTION_DROPDOWN_HORIZONTAL_CHROME;
    return Math.min(maxWidth, Math.max(baseWidth, estimatedWidth));
  }

  private insertReplacement(beforeAt: string, replacement: string, afterCursor: string): void {
    const input = this.inputEl;
    if ('insertReplacement' in input && typeof input.insertReplacement === 'function') {
      input.insertReplacement(beforeAt, replacement, afterCursor);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.inputEl.value = beforeAt + replacement + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private returnToFirstLevel(): void {
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    this.inputEl.value = beforeAt + '@' + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + 1;

    this.activeAgentFilter = false;

    this.showMentionDropdown('');
  }

  private selectMentionItem(): void {
    if (this.filteredMentionItems.length === 0) return;

    const selectedIndex = this.dropdown.getSelectedIndex();
    this.selectedMentionIndex = selectedIndex;
    const selectedItem = this.filteredMentionItems[selectedIndex];
    if (!selectedItem) return;

    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    switch (selectedItem.type) {
      case 'agent-folder':
        // Don't modify input text - just show agents submenu
        this.activeAgentFilter = true;
        this.inputEl.focus();
        this.showMentionDropdown('Agents/');
        return;
      case 'agent': {
        const replacement = `@${selectedItem.id} (agent) `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.callbacks.onAgentMentionSelect?.(selectedItem.id);
        break;
      }
      case 'context-folder': {
        // Root external folder badge only; absolute path is resolved at send time.
        const replacement = `@${selectedItem.name}/ `;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        break;
      }
      case 'folder': {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path);
        this.insertReplacement(beforeAt, `@${normalizedPath ?? selectedItem.path}/ `, afterCursor);
        break;
      }
      case 'file': {
        const rawPath = selectedItem.file.path;
        const normalizedPath = this.callbacks.normalizePathForVault(rawPath);
        if (normalizedPath) {
          this.callbacks.onAttachFile(normalizedPath);
        }
        const alias = getPreferredAlias(selectedItem.aliases, selectedItem.matchedAlias);
        const mentionToken = formatVaultFileMentionToken(
          normalizedPath ?? selectedItem.path,
          alias,
        );
        this.insertReplacement(beforeAt, `${mentionToken} `, afterCursor);
        break;
      }
    }

    this.hide();
    this.inputEl.focus();
  }
}
