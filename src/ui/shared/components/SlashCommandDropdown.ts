import type { SlashCommand } from '@pivi/pivi-agent-core/foundation';
import type { SlashCommandDropdownConfig } from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import { normalizeArgumentHint } from '@pivi/pivi-agent-core/skills/slashCommand';

import type { ComposerInput } from '../mention/composerInputTypes';

type SlashInputElement = ComposerInput | HTMLTextAreaElement | HTMLInputElement;

function getTextOffsetClientRect(inputEl: SlashInputElement, offset: number): DOMRect | null {
  if ('getTextOffsetClientRect' in inputEl && typeof inputEl.getTextOffsetClientRect === 'function') {
    return inputEl.getTextOffsetClientRect(offset);
  }
  return null;
}

export interface DropdownMcpToolSummary {
  name: string;
  description?: string;
}

export interface DropdownMcpToolProvider {
  listTools(serverName: string): Promise<DropdownMcpToolSummary[]>;
}

export interface DropdownMcpServerProvider {
  getServers(): Array<{ name: string; enabled: boolean }>;
}

export interface DropdownSkillSummary {
  name: string;
  description?: string;
}

interface DropdownItem {
  kind: 'command' | 'skill' | 'mcp';
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  displayPrefix: string;
  insertPrefix: string;
  slashCommand?: SlashCommand;
  catalogEntry?: SlashCatalogEntry;
  serverName?: string;
  toolName?: string;
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

    // Scan backward from cursor for the nearest valid trigger char.
    // Valid trigger: at position 0, or preceded by whitespace.
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

    await this.fetchCatalogEntries(currentRequest);

    if (currentRequest !== this.requestId) return;

    await this.fetchMcpToolEntries(currentRequest);

    if (currentRequest !== this.requestId) return;

    const includeBuiltIns = isAtPosition0 && this.activeTriggerChar === '/';
    const allItems = this.buildItemList(includeBuiltIns);

    this.filteredItems = allItems
      .filter(item => this.getItemMatchScore(item, searchLower) < Number.POSITIVE_INFINITY)
      .sort((a, b) => {
        const scoreDelta = this.getItemMatchScore(a, searchLower) - this.getItemMatchScore(b, searchLower);
        if (scoreDelta !== 0) return scoreDelta;
        if (searchLower) {
          const lengthDelta = a.name.length - b.name.length;
          if (lengthDelta !== 0) return lengthDelta;
        }
        return a.name.localeCompare(b.name);
      });

    if (currentRequest !== this.requestId) return;

    if (searchText.length > 0 && this.filteredItems.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = 0;
    this.render();
  }

  private async fetchCatalogEntries(currentRequest: number): Promise<void> {
    if (this.catalogEntriesFetched || !this.getCatalogEntries) return;

    try {
      const entries = await this.getCatalogEntries();
      if (currentRequest !== this.requestId) return;
      if (entries.length > 0) {
        this.cachedCatalogEntries = entries;
        this.catalogEntriesFetched = true;
      }
    } catch {
      if (currentRequest !== this.requestId) return;
    }
  }

  private async fetchMcpToolEntries(currentRequest: number): Promise<void> {
    if (this.mcpToolEntriesFetched) return;

    const mcpManager = this.getMcpManager?.() ?? null;
    const toolProvider = this.getMcpToolProvider?.() ?? null;
    if (!mcpManager || !toolProvider) {
      this.mcpToolEntriesFetched = true;
      return;
    }

    const servers = mcpManager.getServers().filter((server) => server.enabled);
    try {
      const perServerTools = await Promise.all(
        servers.map(async (server) => ({
          serverName: server.name,
          tools: await toolProvider.listTools(server.name),
        })),
      );
      if (currentRequest !== this.requestId) return;

      const entries: DropdownItem[] = [];
      for (const { serverName, tools } of perServerTools) {
        for (const tool of tools) {
          entries.push({
            kind: 'mcp',
            name: `${serverName}/${tool.name}`,
            description: tool.description,
            content: '',
            displayPrefix: '/',
            insertPrefix: '/',
            serverName,
            toolName: tool.name,
          });
        }
      }
      this.cachedMcpToolEntries = entries;
      this.mcpToolEntriesFetched = true;
    } catch {
      if (currentRequest !== this.requestId) return;
      this.mcpToolEntriesFetched = true;
    }
  }

  private buildItemList(_includeBuiltIns: boolean): DropdownItem[] {
    const seenNames = new Set<string>();
    const items: DropdownItem[] = [];

    for (const skill of this.getSkills?.() ?? []) {
      const nameLower = skill.name.toLowerCase();
      if (!seenNames.has(nameLower)) {
        seenNames.add(nameLower);
        items.push({
          kind: 'skill',
          name: skill.name,
          description: skill.description,
          content: '',
          displayPrefix: '/',
          insertPrefix: '/',
          slashCommand: {
            id: `skill:${skill.name}`,
            name: skill.name,
            description: skill.description,
            content: '',
            source: 'sdk',
            kind: 'skill',
          },
        });
      }
    }

    for (const entry of this.cachedMcpToolEntries) {
      const nameLower = entry.name.toLowerCase();
      if (seenNames.has(nameLower)) {
        continue;
      }
      seenNames.add(nameLower);
      items.push(entry);
    }

    for (const entry of this.cachedCatalogEntries) {
      const nameLower = entry.name.toLowerCase();
      if (seenNames.has(nameLower) || this.hiddenCommands.has(nameLower)) {
        continue;
      }
      seenNames.add(nameLower);
      items.push({
        kind: entry.kind === 'command' ? 'command' : 'skill',
        name: entry.name,
        description: entry.description,
        argumentHint: entry.argumentHint,
        content: entry.content,
        displayPrefix: entry.displayPrefix,
        insertPrefix: entry.insertPrefix,
        catalogEntry: entry,
        slashCommand: {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          content: entry.content,
          argumentHint: entry.argumentHint,
          allowedTools: entry.allowedTools,
          model: entry.model,
          source: entry.source,
          kind: entry.kind,
          disableModelInvocation: entry.disableModelInvocation,
          userInvocable: entry.userInvocable,
          context: entry.context,
          agent: entry.agent,
          hooks: entry.hooks,
        },
      });
    }

    return items;
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }

    this.dropdownEl.empty();
    this.detailEl = null;

    if (this.filteredItems.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'pivi-slash-empty' });
      emptyEl.setText('No matching commands');
    } else {
      const listEl = this.dropdownEl.createDiv({ cls: 'pivi-slash-list' });
      listEl.setAttribute('role', 'listbox');
      listEl.setAttribute('aria-label', 'Slash commands');
      listEl.addEventListener('scroll', () => this.positionDetailPanel());

      for (let i = 0; i < this.filteredItems.length; i++) {
        const item = this.filteredItems[i];
        const itemEl = listEl.createDiv({ cls: 'pivi-slash-item' });
        itemEl.setAttribute('role', 'option');
        itemEl.setAttribute('aria-selected', i === this.selectedIndex ? 'true' : 'false');

        if (i === this.selectedIndex) {
          itemEl.addClass('selected');
        }

        const headerEl = itemEl.createDiv({ cls: 'pivi-slash-item-header' });
        headerEl.createSpan({ cls: 'pivi-slash-prefix', text: item.displayPrefix });
        const nameEl = headerEl.createSpan({ cls: 'pivi-slash-name' });
        this.appendHighlightedText(nameEl, item.name, this.currentSearchText);

        if (item.argumentHint) {
          const hintEl = headerEl.createSpan({ cls: 'pivi-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        if (item.description) {
          const descEl = itemEl.createDiv({ cls: 'pivi-slash-desc' });
          this.appendHighlightedText(descEl, item.description, this.currentSearchText);
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
    } else {
      return this.containerEl.createDiv({ cls: 'pivi-slash-dropdown' });
    }
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

    this.detailEl.createDiv({ cls: 'pivi-slash-detail-kind', text: this.getKindLabel(selected) });

    const titleEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-title' });
    titleEl.createSpan({ cls: 'pivi-slash-prefix', text: selected.displayPrefix });
    const nameEl = titleEl.createSpan({ cls: 'pivi-slash-detail-name' });
    this.appendHighlightedText(nameEl, selected.name, this.currentSearchText);

    if (selected.argumentHint) {
      this.detailEl.createDiv({
        cls: 'pivi-slash-detail-hint',
        text: normalizeArgumentHint(selected.argumentHint),
      });
    }

    if (selected.kind === 'mcp' && selected.serverName && selected.toolName) {
      this.detailEl.createDiv({
        cls: 'pivi-slash-detail-meta',
        text: `Server ${selected.serverName} · tool ${selected.toolName}`,
      });
    }

    const descEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-desc' });
    this.appendHighlightedText(
      descEl,
      selected.description?.trim() || 'No description available.',
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

  private appendHighlightedText(parent: HTMLElement, text: string, query: string): void {
    const queryLower = query.toLowerCase();
    if (!queryLower) {
      parent.createSpan({ text });
      return;
    }

    const textLower = text.toLowerCase();
    if (!textLower.includes(queryLower)) {
      if (!this.appendFuzzyHighlightedText(parent, text, queryLower)) {
        parent.createSpan({ text });
      }
      return;
    }

    let cursor = 0;
    let matchIndex = textLower.indexOf(queryLower, cursor);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parent.createSpan({ text: text.slice(cursor, matchIndex) });
      }
      parent.createSpan({ cls: 'pivi-slash-match', text: text.slice(matchIndex, matchIndex + query.length) });
      cursor = matchIndex + query.length;
      matchIndex = textLower.indexOf(queryLower, cursor);
    }

    if (cursor < text.length) {
      parent.createSpan({ text: text.slice(cursor) });
    }
  }

  private appendFuzzyHighlightedText(parent: HTMLElement, text: string, queryLower: string): boolean {
    const indexes = this.getFuzzyMatchIndexes(text.toLowerCase(), queryLower);
    if (!indexes) return false;

    let cursor = 0;
    for (const index of indexes) {
      if (index > cursor) {
        parent.createSpan({ text: text.slice(cursor, index) });
      }
      parent.createSpan({ cls: 'pivi-slash-match', text: text.charAt(index) });
      cursor = index + 1;
    }

    if (cursor < text.length) {
      parent.createSpan({ text: text.slice(cursor) });
    }
    return true;
  }

  private getKindLabel(item: DropdownItem): string {
    switch (item.kind) {
      case 'mcp':
        return 'MCP tool';
      case 'command':
        return 'Command';
      case 'skill':
        return 'Skill';
    }
  }

  private getItemMatchScore(item: DropdownItem, searchLower: string): number {
    if (!searchLower) return 0;

    const nameLower = item.name.toLowerCase();
    const serverToolLower = `${item.serverName ?? ''}/${item.toolName ?? ''}`.toLowerCase();
    const descriptionLower = item.description?.toLowerCase() ?? '';

    const titleScore = Math.min(
      this.getTextMatchScore(nameLower, searchLower),
      this.getTextMatchScore(serverToolLower, searchLower),
    );
    if (titleScore < Number.POSITIVE_INFINITY) return titleScore;

    const descriptionIndex = descriptionLower.indexOf(searchLower);
    if (descriptionIndex !== -1) return 300 + descriptionIndex;
    return Number.POSITIVE_INFINITY;
  }

  private getTextMatchScore(textLower: string, searchLower: string): number {
    if (!textLower) return Number.POSITIVE_INFINITY;
    if (textLower === searchLower) return 0;
    if (textLower.startsWith(searchLower)) return 10 + textLower.length - searchLower.length;

    const boundaryIndex = this.getBoundaryMatchIndex(textLower, searchLower);
    if (boundaryIndex !== -1) return 40 + boundaryIndex;

    const includesIndex = textLower.indexOf(searchLower);
    if (includesIndex !== -1) return 70 + includesIndex;

    const fuzzyIndexes = this.getFuzzyMatchIndexes(textLower, searchLower);
    if (!fuzzyIndexes) return Number.POSITIVE_INFINITY;
    const spread = fuzzyIndexes[fuzzyIndexes.length - 1] - fuzzyIndexes[0];
    return 120 + fuzzyIndexes[0] + spread;
  }

  private getBoundaryMatchIndex(textLower: string, searchLower: string): number {
    for (let i = 1; i < textLower.length; i++) {
      if (this.isSearchBoundary(textLower.charAt(i - 1)) && textLower.startsWith(searchLower, i)) {
        return i;
      }
    }
    return -1;
  }

  private isSearchBoundary(ch: string): boolean {
    return ch === '-' || ch === '_' || ch === '/' || ch === ' ' || ch === '.';
  }

  private getFuzzyMatchIndexes(textLower: string, searchLower: string): number[] | null {
    const indexes: number[] = [];
    let searchIndex = 0;

    for (let i = 0; i < textLower.length && searchIndex < searchLower.length; i++) {
      if (textLower.charAt(i) === searchLower.charAt(searchIndex)) {
        indexes.push(i);
        searchIndex++;
      }
    }

    return searchIndex === searchLower.length ? indexes : null;
  }

  private selectItem(): void {
    if (this.filteredItems.length === 0) return;

    const selected = this.filteredItems[this.selectedIndex];
    if (!selected) return;

    const text = this.getInputValue();
    const beforeTrigger = text.substring(0, this.triggerStartIndex);
    const afterCursor = text.substring(this.getCursorPosition());
    const replacement = `${selected.insertPrefix}${selected.name} `;

    this.setInputValue(beforeTrigger + replacement + afterCursor);
    this.setCursorPosition(beforeTrigger.length + replacement.length);

    this.hide();
    if (selected.slashCommand) {
      this.callbacks.onSelect(selected.slashCommand);
    }
    this.inputEl.focus();
  }
}
