import type { SlashCommand } from '@pivi/pivi-agent-core/foundation';
import type { SlashCommandDropdownConfig } from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { normalizeArgumentHint } from '@pivi/pivi-agent-core/skills/slashCommand';

import { t } from '@/app/i18n';

import type { ComposerInput } from '../mention/composerInputTypes';
import {
  buildItemList,
  type DropdownItem,
  type DropdownMcpServerProvider,
  type DropdownMcpToolProvider,
  type DropdownSkillSummary,
  fetchCatalogEntries,
  fetchMcpToolEntries,
  mergeMcpEntries,
} from './slashCommandDropdownData';
import {
  appendHighlightedText,
  getItemMatchScore,
} from './slashCommandDropdownMatch';

export type {
  DropdownMcpServerProvider,
  DropdownMcpToolProvider,
  DropdownMcpToolSummary,
  DropdownSkillSummary,
} from './slashCommandDropdownData';

type SlashInputElement = ComposerInput | HTMLTextAreaElement | HTMLInputElement;

function getTextOffsetClientRect(inputEl: SlashInputElement, offset: number): DOMRect | null {
  if ('getTextOffsetClientRect' in inputEl && typeof inputEl.getTextOffsetClientRect === 'function') {
    return inputEl.getTextOffsetClientRect(offset);
  }
  return null;
}

export interface SlashCommandDropdownCallbacks {
  onSelect: (command: SlashCommand) => void;
  onHide: () => void;
}

export interface SlashCommandDropdownOptions {
  fixed?: boolean;
  hiddenCommands?: Set<string>;
  catalogConfig?: SlashCommandDropdownConfig;
  getCatalogEntries?: () => Promise<SlashCatalogEntry[]>;
  getMcpManager?: () => DropdownMcpServerProvider | null;
  getMcpToolProvider?: () => DropdownMcpToolProvider | null;
  getSkills?: () => DropdownSkillSummary[];
}

export class SlashCommandDropdown {
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private inputEl: SlashInputElement;
  private callbacks: SlashCommandDropdownCallbacks;
  private enabled = true;
  private onInput: () => void;
  private triggerStartIndex = -1;
  private activeTriggerChar = '/';
  private selectedIndex = 0;
  private filteredItems: DropdownItem[] = [];
  private isFixed: boolean;
  private hiddenCommands: Set<string>;

  private catalogConfig: SlashCommandDropdownConfig | null;
  private getCatalogEntries: (() => Promise<SlashCatalogEntry[]>) | null;
  private getMcpManager: (() => DropdownMcpServerProvider | null) | null;
  private getMcpToolProvider: (() => DropdownMcpToolProvider | null) | null;
  private getSkills: (() => DropdownSkillSummary[]) | null;
  private cachedCatalogEntries: SlashCatalogEntry[] = [];
  private catalogEntriesFetched = false;
  private cachedMcpToolEntries: DropdownItem[] = [];
  private mcpToolEntriesFetched = false;

  private requestId = 0;
  private currentSearchText = '';
  private detailEl: HTMLElement | null = null;

  constructor(
    containerEl: HTMLElement,
    inputEl: ComposerInput | HTMLTextAreaElement | HTMLInputElement,
    callbacks: SlashCommandDropdownCallbacks,
    options: SlashCommandDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.isFixed = options.fixed ?? false;
    this.hiddenCommands = options.hiddenCommands ?? new Set();
    this.catalogConfig = options.catalogConfig ?? null;
    this.getCatalogEntries = options.getCatalogEntries ?? null;
    this.getMcpManager = options.getMcpManager ?? null;
    this.getMcpToolProvider = options.getMcpToolProvider ?? null;
    this.getSkills = options.getSkills ?? null;

    this.onInput = () => this.handleInputChange();
    this.inputEl.addEventListener('input', this.onInput);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }

  setHiddenCommands(commands: Set<string>): void {
    this.hiddenCommands = commands;
  }

  setSlashCatalog(
    config: SlashCommandDropdownConfig,
    getEntries: () => Promise<SlashCatalogEntry[]>,
  ): void {
    this.catalogConfig = config;
    this.getCatalogEntries = getEntries;
    this.cachedCatalogEntries = [];
    this.catalogEntriesFetched = false;
    this.cachedMcpToolEntries = [];
    this.mcpToolEntriesFetched = false;
    this.requestId = 0;
  }

  handleInputChange(): void {
    if (!this.enabled) return;

    const text = this.getInputValue();
    const cursorPos = this.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const triggerChars = this.catalogConfig?.triggerChars ?? ['/'];

    let triggerIndex = -1;
    let triggerChar = '';

    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = textBeforeCursor.charAt(i);
      if (/\s/.test(ch)) break;
      if (triggerChars.includes(ch)) {
        if (i === 0 || /\s/.test(textBeforeCursor.charAt(i - 1))) {
          triggerIndex = i;
          triggerChar = ch;
        }
        break;
      }
    }

    if (triggerIndex === -1) {
      this.hide();
      return;
    }

    const searchText = textBeforeCursor.substring(triggerIndex + 1);

    if (/\s/.test(searchText)) {
      this.hide();
      return;
    }

    this.triggerStartIndex = triggerIndex;
    this.activeTriggerChar = triggerChar;
    const isAtPosition0 = triggerIndex === 0;
    void this.showDropdown(searchText, isAtPosition0);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.enabled || !this.isVisible()) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.navigate(1);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.navigate(-1);
        return true;
      case 'Enter':
      case 'Tab':
        if (this.filteredItems.length > 0) {
          e.preventDefault();
          this.selectItem();
          return true;
        }
        return false;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
    }
    return false;
  }

  isVisible(): boolean {
    return this.dropdownEl?.hasClass('visible') ?? false;
  }

  hide(): void {
    if (this.dropdownEl) {
      this.dropdownEl.removeClass('visible');
    }
    this.containerEl.removeClass('pivi-slash-dropdown-open');
    this.triggerStartIndex = -1;
    this.callbacks.onHide();
  }

  destroy(): void {
    this.inputEl.removeEventListener('input', this.onInput);
    this.containerEl.removeClass('pivi-slash-dropdown-open');
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  resetRuntimeSkillsCache(): void {
    this.cachedCatalogEntries = [];
    this.catalogEntriesFetched = false;
    this.cachedMcpToolEntries = [];
    this.mcpToolEntriesFetched = false;
    this.requestId = 0;
  }

  /** Warm catalog + MCP tool caches in the background so first `/` open is sync from cache. */
  async prefetchCaches(): Promise<void> {
    const currentRequest = ++this.requestId;

    const catalogResult = await fetchCatalogEntries(
      this.catalogEntriesFetched,
      this.getCatalogEntries,
      currentRequest,
      this.requestId,
    );
    if (catalogResult.kind === 'cancelled') return;
    if (catalogResult.kind === 'ok') {
      this.cachedCatalogEntries = catalogResult.entries;
      this.catalogEntriesFetched = true;
    }

    if (currentRequest !== this.requestId) return;

    const mcpResult = await fetchMcpToolEntries(
      this.mcpToolEntriesFetched,
      this.getMcpManager,
      this.getMcpToolProvider,
      currentRequest,
      this.requestId,
    );
    if (mcpResult.kind === 'cancelled') return;
    if (mcpResult.kind === 'ok') {
      this.cachedMcpToolEntries = mcpResult.fetched
        ? mcpResult.entries
        : mergeMcpEntries(this.cachedMcpToolEntries, mcpResult.entries);
      this.mcpToolEntriesFetched = mcpResult.fetched;
    } else if (mcpResult.fetched) {
      this.mcpToolEntriesFetched = true;
    }
  }

  private getInputValue(): string {
    return this.inputEl.value;
  }

  private getCursorPosition(): number {
    return this.inputEl.selectionStart || 0;
  }

  private setInputValue(value: string): void {
    this.inputEl.value = value;
  }

  private setCursorPosition(pos: number): void {
    this.inputEl.selectionStart = pos;
    this.inputEl.selectionEnd = pos;
  }

  private async showDropdown(searchText: string, isAtPosition0 = true): Promise<void> {
    const currentRequest = ++this.requestId;
    const searchLower = searchText.toLowerCase();
    this.currentSearchText = searchText;

    const catalogResult = await fetchCatalogEntries(
      this.catalogEntriesFetched,
      this.getCatalogEntries,
      currentRequest,
      this.requestId,
    );
    if (catalogResult.kind === 'cancelled') return;
    if (catalogResult.kind === 'ok') {
      this.cachedCatalogEntries = catalogResult.entries;
      this.catalogEntriesFetched = true;
    }

    if (currentRequest !== this.requestId) return;

    const mcpResult = await fetchMcpToolEntries(
      this.mcpToolEntriesFetched,
      this.getMcpManager,
      this.getMcpToolProvider,
      currentRequest,
      this.requestId,
    );
    if (mcpResult.kind === 'cancelled') return;
    if (mcpResult.kind === 'ok') {
      this.cachedMcpToolEntries = mcpResult.fetched
        ? mcpResult.entries
        : mergeMcpEntries(this.cachedMcpToolEntries, mcpResult.entries);
      this.mcpToolEntriesFetched = mcpResult.fetched;
    } else if (mcpResult.fetched) {
      this.mcpToolEntriesFetched = true;
    }

    if (currentRequest !== this.requestId) return;

    const includeBuiltIns = isAtPosition0 && this.activeTriggerChar === '/';
    const allItems = buildItemList(
      this.getSkills,
      this.cachedMcpToolEntries,
      this.cachedCatalogEntries,
      this.hiddenCommands,
      includeBuiltIns,
    );

    this.filteredItems = allItems
      .filter(item => getItemMatchScore(item, searchLower) < Number.POSITIVE_INFINITY)
      .sort((a, b) => {
        const scoreDelta = getItemMatchScore(a, searchLower) - getItemMatchScore(b, searchLower);
        if (scoreDelta !== 0) return scoreDelta;
        if (searchLower) {
          const lengthDelta = a.displayName.length - b.displayName.length;
          if (lengthDelta !== 0) return lengthDelta;
        }
        return a.displayName.localeCompare(b.displayName);
      });

    if (currentRequest !== this.requestId) return;

    if (searchText.length > 0 && this.filteredItems.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = 0;
    this.render();
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }

    this.dropdownEl.empty();
    this.detailEl = null;

    if (this.filteredItems.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'pivi-slash-empty' });
      emptyEl.setText(t('chat.slash.noMatches'));
    } else {
      const listEl = this.dropdownEl.createDiv({ cls: 'pivi-slash-list' });
      listEl.setAttribute('role', 'listbox');
      listEl.setAttribute('aria-label', t('chat.slash.ariaLabel'));
      listEl.addEventListener('scroll', () => this.positionDetailPanel());

      for (let i = 0; i < this.filteredItems.length; i++) {
        const item = this.filteredItems[i];
        if (!item) continue;
        const itemEl = listEl.createDiv({ cls: 'pivi-slash-item' });
        itemEl.setAttribute('role', 'option');
        itemEl.setAttribute('aria-selected', i === this.selectedIndex ? 'true' : 'false');

        if (i === this.selectedIndex) {
          itemEl.addClass('selected');
        }

        const headerEl = itemEl.createDiv({ cls: 'pivi-slash-item-header' });
        headerEl.createSpan({ cls: 'pivi-slash-prefix', text: item.displayPrefix });
        const nameEl = headerEl.createSpan({ cls: 'pivi-slash-name' });
        appendHighlightedText(nameEl, item.displayName, this.currentSearchText);

        if (item.argumentHint) {
          const hintEl = headerEl.createSpan({ cls: 'pivi-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        if (item.description) {
          const descEl = itemEl.createDiv({ cls: 'pivi-slash-desc' });
          appendHighlightedText(descEl, item.description, this.currentSearchText);
        }

        itemEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.selectItem();
        });

        itemEl.addEventListener('mouseenter', () => {
          this.selectedIndex = i;
          this.updateSelection();
        });
      }

      this.detailEl = this.dropdownEl.createDiv({ cls: 'pivi-slash-detail' });
      this.renderDetailPanel();
    }

    this.dropdownEl.addClass('visible');
    this.containerEl.addClass('pivi-slash-dropdown-open');

    if (this.isFixed) {
      this.positionFixed();
    } else {
      this.positionAnchored();
    }
  }

  private createDropdownElement(): HTMLElement {
    if (this.isFixed) {
      return this.containerEl.createDiv({
        cls: 'pivi-slash-dropdown pivi-slash-dropdown-fixed',
      });
    }
    return this.containerEl.createDiv({ cls: 'pivi-slash-dropdown' });
  }

  private positionFixed(): void {
    if (!this.dropdownEl || !this.isFixed) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    const anchorRect = getTextOffsetClientRect(this.inputEl, this.triggerStartIndex) ?? inputRect;
    const dropdownWidth = Math.min(300, Math.max(220, inputRect.width / 2));
    const left = Math.min(
      Math.max(anchorRect.left, inputRect.left),
      Math.max(inputRect.left, inputRect.right - dropdownWidth),
    );

    this.dropdownEl.setCssProps({
      '--pivi-fixed-dropdown-bottom': `${window.innerHeight - anchorRect.top + 4}px`,
      '--pivi-fixed-dropdown-left': `${left}px`,
      '--pivi-fixed-dropdown-width': `${dropdownWidth}px`,
    });
  }

  private positionAnchored(): void {
    if (!this.dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    const anchorRect = getTextOffsetClientRect(this.inputEl, this.triggerStartIndex) ?? inputRect;
    const containerRect = this.containerEl.getBoundingClientRect();
    const dropdownWidth = Math.min(300, Math.max(220, inputRect.width / 2));
    const left = Math.min(
      Math.max(anchorRect.left - containerRect.left, 0),
      Math.max(0, containerRect.width - dropdownWidth),
    );
    const bottom = Math.max(0, containerRect.bottom - anchorRect.top + 4);

    this.dropdownEl.setCssProps({
      '--pivi-anchored-dropdown-bottom': `${bottom}px`,
      '--pivi-anchored-dropdown-left': `${left}px`,
      '--pivi-anchored-dropdown-width': `${dropdownWidth}px`,
    });
  }

  private navigate(direction: number): void {
    const maxIndex = this.filteredItems.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }

  private updateSelection(): void {
    const items = this.dropdownEl?.querySelectorAll('.pivi-slash-item');
    items?.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.addClass('selected');
        item.setAttribute('aria-selected', 'true');
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('selected');
        item.setAttribute('aria-selected', 'false');
      }
    });
    this.renderDetailPanel();
  }

  private renderDetailPanel(): void {
    if (!this.detailEl) return;

    const selected = this.filteredItems[this.selectedIndex];
    this.detailEl.empty();
    if (!selected) return;

    const kindLabel = selected.kind === 'mcp'
      ? t(selected.toolName ? 'chat.slash.kindMcpTool' : 'chat.slash.kindMcpServer')
      : t(selected.kind === 'command' ? 'chat.slash.kindCommand' : 'chat.slash.kindSkill');
    this.detailEl.createDiv({ cls: 'pivi-slash-detail-kind', text: kindLabel });

    const titleEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-title' });
    titleEl.createSpan({ cls: 'pivi-slash-prefix', text: selected.displayPrefix });
    const nameEl = titleEl.createSpan({ cls: 'pivi-slash-detail-name' });
    appendHighlightedText(nameEl, selected.displayName, this.currentSearchText);

    if (selected.argumentHint) {
      this.detailEl.createDiv({
        cls: 'pivi-slash-detail-hint',
        text: normalizeArgumentHint(selected.argumentHint),
      });
    }

    if (selected.kind === 'mcp' && selected.serverName) {
      this.detailEl.createDiv({
        cls: 'pivi-slash-detail-meta',
        text: selected.toolName
          ? t('chat.slash.mcpToolDetail', { server: selected.serverName, tool: selected.toolName })
          : t('chat.slash.mcpServerDetail', { server: selected.serverName }),
      });
    }

    const descEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-desc' });
    appendHighlightedText(
      descEl,
      selected.description?.trim() || t('chat.stream.noDescription'),
      this.currentSearchText,
    );
    this.positionDetailPanel();
  }

  private positionDetailPanel(): void {
    if (!this.dropdownEl || !this.detailEl) return;

    const selectedEl = this.dropdownEl.querySelector<HTMLElement>('.pivi-slash-item.selected');
    if (!selectedEl) return;

    const dropdownRect = this.dropdownEl.getBoundingClientRect();
    const selectedRect = selectedEl.getBoundingClientRect();
    const top = Math.max(0, selectedRect.top - dropdownRect.top);
    this.detailEl.setCssProps({
      '--pivi-slash-detail-top': `${top}px`,
    });
  }

  private selectItem(): void {
    if (this.filteredItems.length === 0) return;

    const selected = this.filteredItems[this.selectedIndex];
    if (!selected) return;

    const text = this.getInputValue();
    const beforeTrigger = text.substring(0, this.triggerStartIndex);
    const afterCursor = text.substring(this.getCursorPosition());
    const replacement = `${selected.insertPrefix}${selected.insertValue} `;

    this.setInputValue(beforeTrigger + replacement + afterCursor);
    this.setCursorPosition(beforeTrigger.length + replacement.length);

    this.hide();
    if (selected.slashCommand) {
      this.callbacks.onSelect(selected.slashCommand);
    }
    this.inputEl.focus();
  }
}
