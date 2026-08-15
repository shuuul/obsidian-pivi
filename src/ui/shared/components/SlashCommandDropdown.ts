import type { SlashCommand } from '@pivi/agent/foundation';
import type { SlashCommandDropdownConfig } from '@pivi/agent/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';
import { NEW_SESSION_COMMAND_ID } from '@pivi/agent/skills/commands/slashCommandIds';
import { normalizeArgumentHint } from '@pivi/agent/skills/slashCommand';
import { setIcon } from 'obsidian';

import { t } from '@/app/i18n';
import { getActiveWindow } from '@/ui/shared/dom';

import type { ComposerInput } from '../mention/composerInputTypes';
import { appendMcpIcon } from '../utils/icons';
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
  positionAnchoredSlashDropdown,
  positionFixedSlashDropdown,
  positionSlashDetailPanel,
} from './slashCommandDropdownLayout';
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

function renderItemIcon(container: HTMLElement, item: DropdownItem): void {
  container.addClass(`pivi-slash-icon--${item.kind}`);
  container.setAttribute('aria-hidden', 'true');
  if (item.kind === 'mcp') {
    appendMcpIcon(container);
    return;
  }
  const iconName = item.kind === 'command'
    ? 'terminal'
    : item.kind === 'skill'
      ? 'sparkles'
      : 'image-plus';
  setIcon(container, iconName);
}

export interface SlashCommandDropdownCallbacks {
  onSelect: (command: SlashCommand) => void;
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
  private onInput: () => void;
  private triggerStartIndex = -1;
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
  private cacheGeneration = 0;
  private catalogLoadPromise: Promise<void> | null = null;
  private mcpToolLoadPromise: Promise<void> | null = null;

  private requestId = 0;
  private currentSearchText = '';
  private isLoading = false;
  private detailEl: HTMLElement | null = null;
  private overlayListenersAttached = false;

  private get ownerWindow(): Window {
    return getActiveWindow(this.containerEl);
  }

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

  setHiddenCommands(commands: Set<string>): void {
    this.hiddenCommands = commands;
  }

  setSlashCatalog(
    config: SlashCommandDropdownConfig,
    getEntries: () => Promise<SlashCatalogEntry[]>,
  ): void {
    this.catalogConfig = config;
    this.getCatalogEntries = getEntries;
    this.invalidateCaches();
    this.requestId += 1;
  }

  handleInputChange(): void {
    const text = this.getInputValue();
    const cursorPos = this.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const triggerChars = this.catalogConfig?.triggerChars ?? ['/'];

    let triggerIndex = -1;

    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = textBeforeCursor.charAt(i);
      if (/\s/.test(ch)) break;
      if (triggerChars.includes(ch)) {
        if (i === 0 || /\s/.test(textBeforeCursor.charAt(i - 1))) {
          triggerIndex = i;
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
    void this.showDropdown(searchText);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (!this.isVisible()) return false;

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
        if (!e.isComposing && this.filteredItems.length > 0) {
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
    this.requestId += 1;
    this.removeOverlayListeners();
    if (this.dropdownEl) {
      this.dropdownEl.removeClass('visible');
    }
    this.containerEl.removeClass('pivi-slash-dropdown-open');
    this.triggerStartIndex = -1;
  }

  destroy(): void {
    this.requestId += 1;
    this.cacheGeneration += 1;
    this.catalogLoadPromise = null;
    this.mcpToolLoadPromise = null;
    this.removeOverlayListeners();
    this.inputEl.removeEventListener('input', this.onInput);
    this.containerEl.removeClass('pivi-slash-dropdown-open');
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  resetRuntimeSkillsCache(): void {
    this.invalidateCaches();
    this.requestId += 1;
  }

  private invalidateCaches(): void {
    this.cachedCatalogEntries = [];
    this.catalogEntriesFetched = false;
    this.cachedMcpToolEntries = [];
    this.mcpToolEntriesFetched = false;
    this.cacheGeneration += 1;
    this.catalogLoadPromise = null;
    this.mcpToolLoadPromise = null;
  }

  /** Warm catalog + MCP tool caches without delaying or invalidating an active selector. */
  async prefetchCaches(): Promise<void> {
    await Promise.all([
      this.loadCatalogEntries().catch(() => undefined),
      this.loadMcpToolEntries().catch(() => undefined),
    ]);
  }

  /**
   * One generation-checked load that both populates caches and propagates failures.
   * Management commits require observable failures; ordinary settings warmup stays best effort.
   */
  async prefetchCachesStrict(): Promise<void> {
    await Promise.all([
      this.loadCatalogEntries({ strict: true }),
      this.loadMcpToolEntries({ strict: true }),
    ]);
  }

  /**
   * Single-flight catalog load. Rejects on failure so strict callers observe it;
   * best-effort callers (dropdown open / prefetchCaches) swallow at the call site.
   * Strict joiners of a failed/incomplete flight restart once so success is never
   * reported after a swallowed failure.
   */
  private loadCatalogEntries(options: { strict?: boolean } = {}): Promise<void> {
    if (this.catalogEntriesFetched || !this.getCatalogEntries) {
      return Promise.resolve();
    }
    if (this.catalogLoadPromise) {
      if (!options.strict) return this.catalogLoadPromise;
      return this.joinStrictAfter(this.catalogLoadPromise, () => this.catalogEntriesFetched, () => (
        this.loadCatalogEntries({ strict: true })
      ));
    }

    const generation = this.cacheGeneration;
    let loadPromise: Promise<void>;
    loadPromise = fetchCatalogEntries(false, this.getCatalogEntries, { strict: true })
      .then((result) => {
        if (generation !== this.cacheGeneration || result.kind !== 'ok') return;
        this.cachedCatalogEntries = result.entries;
        this.catalogEntriesFetched = true;
      })
      .finally(() => {
        if (this.catalogLoadPromise === loadPromise) this.catalogLoadPromise = null;
      });
    // Keep the shared slot from becoming an unhandled rejection when only best-effort waits.
    if (!options.strict) {
      void loadPromise.catch(() => undefined);
    }
    this.catalogLoadPromise = loadPromise;
    return loadPromise;
  }

  /**
   * Single-flight MCP tool load. Strict mode fails any remote rejection;
   * best-effort mode keeps partial results and remains retryable.
   */
  private loadMcpToolEntries(options: { strict?: boolean } = {}): Promise<void> {
    if (this.mcpToolEntriesFetched || !this.getMcpManager) {
      return Promise.resolve();
    }
    if (this.mcpToolLoadPromise) {
      if (!options.strict) return this.mcpToolLoadPromise;
      return this.joinStrictAfter(this.mcpToolLoadPromise, () => this.mcpToolEntriesFetched, () => (
        this.loadMcpToolEntries({ strict: true })
      ));
    }

    const generation = this.cacheGeneration;
    const strict = options.strict === true;
    let loadPromise: Promise<void>;
    loadPromise = fetchMcpToolEntries(
      false,
      this.getMcpManager,
      this.getMcpToolProvider,
      { strict },
    )
      .then((result) => {
        if (generation !== this.cacheGeneration) return;
        if (result.kind === 'ok') {
          this.cachedMcpToolEntries = result.fetched
            ? result.entries
            : mergeMcpEntries(this.cachedMcpToolEntries, result.entries);
          this.mcpToolEntriesFetched = result.fetched;
        } else if (result.fetched) {
          this.mcpToolEntriesFetched = true;
        }
      })
      .finally(() => {
        if (this.mcpToolLoadPromise === loadPromise) this.mcpToolLoadPromise = null;
      });
    if (!strict) {
      void loadPromise.catch(() => undefined);
    }
    this.mcpToolLoadPromise = loadPromise;
    return loadPromise;
  }

  /** After an in-flight load settles, restart strict if the cache was not fully populated. */
  private async joinStrictAfter(
    inFlight: Promise<void>,
    isFetched: () => boolean,
    restart: () => Promise<void>,
  ): Promise<void> {
    const generation = this.cacheGeneration;
    try {
      await inFlight;
    } catch {
      // Prior flight failed; fall through to a strict restart.
    }
    if (generation !== this.cacheGeneration || isFetched()) return;
    return restart();
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

  private showDropdown(searchText: string): void {
    const currentRequest = ++this.requestId;
    this.currentSearchText = searchText;
    const pendingLoads: Promise<void>[] = [];
    if (!this.catalogEntriesFetched && this.getCatalogEntries !== null) {
      pendingLoads.push(this.loadCatalogEntries().catch(() => undefined));
    }
    if (!this.mcpToolEntriesFetched && this.getMcpManager !== null) {
      pendingLoads.push(this.loadMcpToolEntries().catch(() => undefined));
    }

    this.filterAndRender(searchText, pendingLoads.length === 0);
    if (pendingLoads.length === 0) return;

    let remainingLoads = pendingLoads.length;
    for (const load of pendingLoads) {
      void load.then(() => {
        remainingLoads -= 1;
        if (currentRequest === this.requestId) {
          this.filterAndRender(searchText, remainingLoads === 0);
        }
      });
    }
  }

  private filterAndRender(searchText: string, hideWhenEmpty: boolean): void {
    const searchLower = searchText.toLowerCase();
    const allItems = buildItemList(
      this.getSkills,
      this.cachedMcpToolEntries,
      this.cachedCatalogEntries,
      this.hiddenCommands,
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
    this.isLoading = !hideWhenEmpty && this.filteredItems.length === 0;

    if (hideWhenEmpty && searchText.length > 0 && this.filteredItems.length === 0) {
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
      emptyEl.setText(t(this.isLoading ? 'common.loading' : 'chat.slash.noMatches'));
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

        const iconEl = itemEl.createSpan({ cls: 'pivi-slash-icon' });
        renderItemIcon(iconEl, item);
        const contentEl = itemEl.createDiv({ cls: 'pivi-slash-item-content' });
        const headerEl = contentEl.createDiv({ cls: 'pivi-slash-item-header' });
        const nameEl = headerEl.createSpan({ cls: 'pivi-slash-name' });
        appendHighlightedText(nameEl, item.displayName, this.currentSearchText);

        if (item.argumentHint) {
          const hintEl = headerEl.createSpan({ cls: 'pivi-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        if (item.description) {
          const descEl = contentEl.createDiv({ cls: 'pivi-slash-desc' });
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
    this.positionDetailPanel();
    this.ensureOverlayListeners();
  }

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    const OwnerNode = this.containerEl.ownerDocument?.defaultView?.Node;
    if (!target || !OwnerNode || !(target instanceof OwnerNode)) return;
    if (this.dropdownEl?.contains(target) || this.inputEl.contains(target)) return;
    this.hide();
  };

  private readonly onOwnerScroll = (): void => {
    if (!this.isVisible()) return;
    if (this.triggerStartIndex < 0) {
      this.hide();
      return;
    }
    if (this.isFixed) {
      this.positionFixed();
    } else {
      this.positionAnchored();
    }
    this.positionDetailPanel();
  };

  private ensureOverlayListeners(): void {
    if (this.overlayListenersAttached) return;
    const ownerDocument = this.containerEl.ownerDocument;
    if (!ownerDocument?.addEventListener) return;
    ownerDocument.addEventListener('pointerdown', this.onOutsidePointerDown, true);
    this.ownerWindow.addEventListener('scroll', this.onOwnerScroll, true);
    this.overlayListenersAttached = true;
  }

  private removeOverlayListeners(): void {
    if (!this.overlayListenersAttached) return;
    const ownerDocument = this.containerEl.ownerDocument;
    if (ownerDocument?.removeEventListener) {
      ownerDocument.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
    }
    this.ownerWindow.removeEventListener('scroll', this.onOwnerScroll, true);
    this.overlayListenersAttached = false;
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
    positionFixedSlashDropdown(
      this.dropdownEl,
      this.inputEl,
      this.containerEl,
      this.filteredItems,
      this.triggerStartIndex,
    );
  }

  private positionAnchored(): void {
    if (!this.dropdownEl) return;
    positionAnchoredSlashDropdown(
      this.dropdownEl,
      this.inputEl,
      this.containerEl,
      this.filteredItems,
      this.triggerStartIndex,
    );
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
      : t(selected.kind === 'command'
        ? 'chat.slash.kindCommand'
        : selected.kind === 'skill'
          ? 'chat.slash.kindSkill'
          : 'chat.slash.kindTool');
    const kindEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-kind' });
    const kindIconEl = kindEl.createSpan({ cls: 'pivi-slash-icon' });
    renderItemIcon(kindIconEl, selected);
    kindEl.createSpan({ text: kindLabel });

    const titleEl = this.detailEl.createDiv({ cls: 'pivi-slash-detail-title' });
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
    positionSlashDetailPanel(this.dropdownEl, this.detailEl, this.containerEl);
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
    // New-session selection activates another tab synchronously through the
    // callback; do not return focus to the input belonging to the old tab.
    if (selected.slashCommand?.id !== NEW_SESSION_COMMAND_ID) {
      this.inputEl.focus();
    }
  }
}
