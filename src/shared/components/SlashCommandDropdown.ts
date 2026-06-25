import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type { SlashCommandDropdownConfig } from '../../core/agent/commands/SlashCommandCatalog';
import type { SlashCatalogEntry } from '../../core/agent/commands/SlashCommandEntry';
import type { SlashCommand } from '../../core/types';
import { normalizeArgumentHint } from '../../utils/slashCommand';
import type { ComposerInput } from '../mention/composerInputTypes';

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
}

export class SlashCommandDropdown {
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private inputEl: ComposerInput | HTMLTextAreaElement | HTMLInputElement;
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
    this.containerEl.removeClass('obsius2-slash-dropdown-open');
    this.triggerStartIndex = -1;
    this.callbacks.onHide();
  }

  destroy(): void {
    this.inputEl.removeEventListener('input', this.onInput);
    this.containerEl.removeClass('obsius2-slash-dropdown-open');
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
      .filter(item => this.getItemMatchRank(item, searchLower) < 4)
      .sort((a, b) => {
        const rankDelta = this.getItemMatchRank(a, searchLower) - this.getItemMatchRank(b, searchLower);
        if (rankDelta !== 0) return rankDelta;
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

    const mcpManager = AgentWorkspace.getMcpServerManager();
    const toolProvider = AgentWorkspace.getMcpToolProvider();
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

    for (const skill of AgentWorkspace.getSkillProvider()?.listSkills() ?? []) {
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
      const emptyEl = this.dropdownEl.createDiv({ cls: 'obsius2-slash-empty' });
      emptyEl.setText('No matching commands');
    } else {
      const listEl = this.dropdownEl.createDiv({ cls: 'obsius2-slash-list' });
      listEl.setAttribute('role', 'listbox');
      listEl.setAttribute('aria-label', 'Slash commands');

      for (let i = 0; i < this.filteredItems.length; i++) {
        const item = this.filteredItems[i];
        const itemEl = listEl.createDiv({ cls: 'obsius2-slash-item' });
        itemEl.setAttribute('role', 'option');
        itemEl.setAttribute('aria-selected', i === this.selectedIndex ? 'true' : 'false');

        if (i === this.selectedIndex) {
          itemEl.addClass('selected');
        }

        const headerEl = itemEl.createDiv({ cls: 'obsius2-slash-item-header' });
        headerEl.createSpan({ cls: 'obsius2-slash-prefix', text: item.displayPrefix });
        const nameEl = headerEl.createSpan({ cls: 'obsius2-slash-name' });
        this.appendHighlightedText(nameEl, item.name, this.currentSearchText);

        if (item.argumentHint) {
          const hintEl = headerEl.createSpan({ cls: 'obsius2-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        if (item.description) {
          const descEl = itemEl.createDiv({ cls: 'obsius2-slash-desc' });
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

      this.detailEl = this.dropdownEl.createDiv({ cls: 'obsius2-slash-detail' });
      this.renderDetailPanel();
    }

    this.dropdownEl.addClass('visible');
    this.containerEl.addClass('obsius2-slash-dropdown-open');

    if (this.isFixed) {
      this.positionFixed();
    }
  }

  private createDropdownElement(): HTMLElement {
    if (this.isFixed) {
      return this.containerEl.createDiv({
        cls: 'obsius2-slash-dropdown obsius2-slash-dropdown-fixed',
      });
    } else {
      return this.containerEl.createDiv({ cls: 'obsius2-slash-dropdown' });
    }
  }

  private positionFixed(): void {
    if (!this.dropdownEl || !this.isFixed) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    this.dropdownEl.setCssProps({
      '--obsius2-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--obsius2-fixed-dropdown-left': `${inputRect.left}px`,
      '--obsius2-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private navigate(direction: number): void {
    const maxIndex = this.filteredItems.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }

  private updateSelection(): void {
    const items = this.dropdownEl?.querySelectorAll('.obsius2-slash-item');
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

    this.detailEl.createDiv({ cls: 'obsius2-slash-detail-kind', text: this.getKindLabel(selected) });

    const titleEl = this.detailEl.createDiv({ cls: 'obsius2-slash-detail-title' });
    titleEl.createSpan({ cls: 'obsius2-slash-prefix', text: selected.displayPrefix });
    const nameEl = titleEl.createSpan({ cls: 'obsius2-slash-detail-name' });
    this.appendHighlightedText(nameEl, selected.name, this.currentSearchText);

    if (selected.argumentHint) {
      this.detailEl.createDiv({
        cls: 'obsius2-slash-detail-hint',
        text: normalizeArgumentHint(selected.argumentHint),
      });
    }

    if (selected.kind === 'mcp' && selected.serverName && selected.toolName) {
      this.detailEl.createDiv({
        cls: 'obsius2-slash-detail-meta',
        text: `Server ${selected.serverName} · tool ${selected.toolName}`,
      });
    }

    const descEl = this.detailEl.createDiv({ cls: 'obsius2-slash-detail-desc' });
    this.appendHighlightedText(
      descEl,
      selected.description?.trim() || 'No description available.',
      this.currentSearchText,
    );
  }

  private appendHighlightedText(parent: HTMLElement, text: string, query: string): void {
    const queryLower = query.toLowerCase();
    if (!queryLower) {
      parent.createSpan({ text });
      return;
    }

    const textLower = text.toLowerCase();
    let cursor = 0;
    let matchIndex = textLower.indexOf(queryLower, cursor);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        parent.createSpan({ text: text.slice(cursor, matchIndex) });
      }
      parent.createSpan({ cls: 'obsius2-slash-match', text: text.slice(matchIndex, matchIndex + query.length) });
      cursor = matchIndex + query.length;
      matchIndex = textLower.indexOf(queryLower, cursor);
    }

    if (cursor < text.length) {
      parent.createSpan({ text: text.slice(cursor) });
    }
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

  private getItemMatchRank(item: DropdownItem, searchLower: string): number {
    if (!searchLower) return 0;

    const nameLower = item.name.toLowerCase();
    const serverToolLower = `${item.serverName ?? ''}/${item.toolName ?? ''}`.toLowerCase();
    const descriptionLower = item.description?.toLowerCase() ?? '';

    if (nameLower === searchLower || serverToolLower === searchLower) return 0;
    if (nameLower.startsWith(searchLower) || serverToolLower.startsWith(searchLower)) return 1;
    if (nameLower.includes(searchLower) || serverToolLower.includes(searchLower)) return 2;
    if (descriptionLower.includes(searchLower)) return 3;
    return 4;
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
