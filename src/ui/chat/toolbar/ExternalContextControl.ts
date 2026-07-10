import { Notice, setIcon, setTooltip } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { expandHomePath, normalizePathForFilesystem } from "@/app/hostPlatform";
import { t } from '@/i18n';

import {
  findConflictingPath,
  isDuplicatePath,
  normalizePathForComparison,
  validateDirectoryPath,
} from '../../shared/utils/externalContext';
import { pickDirectoryPath } from '../../shared/utils/folderPicker';
import type { ToolbarCallbacks } from './ToolbarTypes';

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

function uniqueNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pathValue of paths) {
    const key = normalizePathForComparison(pathValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(pathValue);
  }
  return result;
}

export class ExternalContextSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  /** Settings-backed roots. They survive session changes and start selected. */
  private pinnedPaths: string[] = [];
  /** Roots added only for the current session. */
  private sessionPaths: string[] = [];
  /** Checked roots sent to the agent for the current turn. */
  private selectedPathKeys = new Set<string>();
  private onPinnedChangeCallback: ((paths: string[]) => void | Promise<void>) | null = null;

  constructor(parentEl: HTMLElement, _callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'pivi-external-context-selector' });
    this.render();
  }

  setOnPinnedChange(callback: (paths: string[]) => void | Promise<void>): void {
    this.onPinnedChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return this.getCatalogPaths().filter((pathStr) => this.isChecked(pathStr));
  }

  getPinnedPaths(): string[] {
    return [...this.pinnedPaths];
  }

  /** Refresh settings-backed pins without discarding current session-only roots. */
  setPinnedPaths(paths: string[]): void {
    const previousPinnedKeys = new Set(this.pinnedPaths.map(normalizePathForComparison));
    const nextPinned = uniqueNormalizedPaths(paths);
    const nextPinnedKeys = new Set(nextPinned.map(normalizePathForComparison));

    for (const pathStr of nextPinned) {
      const key = normalizePathForComparison(pathStr);
      if (!previousPinnedKeys.has(key)) {
        this.selectedPathKeys.add(key);
      }
    }
    this.sessionPaths = this.sessionPaths.filter(
      (pathStr) => !nextPinnedKeys.has(normalizePathForComparison(pathStr)),
    );
    this.pinnedPaths = nextPinned;
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Start a fresh session: discard all unpinned roots and select every pin. */
  resetForSession(pinnedPaths: string[]): void {
    this.pinnedPaths = uniqueNormalizedPaths(pinnedPaths);
    this.sessionPaths = [];
    this.selectedPathKeys = new Set(this.pinnedPaths.map(normalizePathForComparison));
    this.updateDisplay();
    this.renderDropdown();
  }

  togglePath(pathStr: string): void {
    const key = normalizePathForComparison(pathStr);
    if (this.selectedPathKeys.has(key)) {
      this.selectedPathKeys.delete(key);
    } else {
      this.selectedPathKeys.add(key);
    }
    this.updateDisplay();
    this.renderDropdown();
  }

  removePath(pathStr: string): void {
    this.sessionPaths = this.sessionPaths.filter(
      (p) => normalizePathForComparison(p) !== normalizePathForComparison(pathStr),
    );
    this.selectedPathKeys.delete(normalizePathForComparison(pathStr));
    this.updateDisplay();
    this.renderDropdown();
  }

  togglePinned(pathStr: string): void {
    const key = normalizePathForComparison(pathStr);
    if (this.isPinned(pathStr)) {
      // Unpinning keeps this root available only in the originating session;
      // settings synchronization removes it from other tabs' pin catalogs.
      this.pinnedPaths = this.pinnedPaths.filter(
        (p) => normalizePathForComparison(p) !== key,
      );
      this.sessionPaths = uniqueNormalizedPaths([...this.sessionPaths, pathStr]);
    } else {
      this.sessionPaths = this.sessionPaths.filter(
        (p) => normalizePathForComparison(p) !== key,
      );
      this.pinnedPaths = uniqueNormalizedPaths([...this.pinnedPaths, pathStr]);
    }
    void this.onPinnedChangeCallback?.([...this.pinnedPaths]);
    this.updateDisplay();
    this.renderDropdown();
  }

  /**
   * Add an external context path programmatically.
   * Validates the path and handles duplicates/conflicts.
   */
  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) {
      return { success: false, error: 'No path provided.' };
    }

    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }

    const expandedPath = expandHomePath(cleanPath);
    const normalizedPath = normalizePathForFilesystem(expandedPath);

    if (!path.isAbsolute(normalizedPath)) {
      return { success: false, error: 'Path must be absolute.' };
    }

    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) {
      return { success: false, error: `${validation.error}: ${pathInput}` };
    }

    const catalog = this.getCatalogPaths();
    if (isDuplicatePath(normalizedPath, catalog)) {
      return { success: false, error: 'This folder is already added as an external context.' };
    }

    const conflict = findConflictingPath(normalizedPath, catalog);
    if (conflict) {
      return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    }

    this.sessionPaths = uniqueNormalizedPaths([...this.sessionPaths, normalizedPath]);
    this.selectedPathKeys.add(normalizePathForComparison(normalizedPath));
    this.updateDisplay();
    this.renderDropdown();

    return { success: true, normalizedPath };
  }

  private isPinned(pathStr: string): boolean {
    return this.pinnedPaths.some(
      (p) => normalizePathForComparison(p) === normalizePathForComparison(pathStr),
    );
  }

  private isChecked(pathStr: string): boolean {
    return this.selectedPathKeys.has(normalizePathForComparison(pathStr));
  }

  private getCatalogPaths(): string[] {
    return uniqueNormalizedPaths([...this.pinnedPaths, ...this.sessionPaths]);
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'pivi-external-context-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-external-context-dropdown' });
    this.renderDropdown();
    this.updateDropdownMaxWidth();
    this.container.addEventListener('mouseenter', () => this.updateDropdownMaxWidth());
    this.container.addEventListener('focusin', () => this.updateDropdownMaxWidth());
  }

  private updateDropdownMaxWidth(): void {
    if (!this.dropdownEl) return;
    const ownerWindow = this.container.ownerDocument.defaultView ?? activeWindow;
    const left = this.container.getBoundingClientRect().left;
    const availableWidth = Math.max(0, ownerWindow.innerWidth - left - 20);
    this.dropdownEl.style.setProperty(
      '--pivi-external-context-max-width',
      `${availableWidth}px`,
    );
  }

  private async openFolderPicker() {
    try {
      const selectedPath = await pickDirectoryPath({
        title: t('chat.toolbar.externalPickerTitle'),
        hostWindow: this.container.ownerDocument.defaultView ?? activeWindow,
      });
      if (!selectedPath) {
        return;
      }

      const catalog = this.getCatalogPaths();
      if (isDuplicatePath(selectedPath, catalog)) {
        new Notice(t('chat.toolbar.externalAlreadyAdded'), 3000);
        return;
      }

      const conflict = findConflictingPath(selectedPath, catalog);
      if (conflict) {
        new Notice(this.formatConflictMessage(selectedPath, conflict), 5000);
        return;
      }

      this.sessionPaths = uniqueNormalizedPaths([...this.sessionPaths, selectedPath]);
      this.selectedPathKeys.add(normalizePathForComparison(selectedPath));
      this.updateDisplay();
      this.renderDropdown();
    } catch {
      new Notice(t('chat.toolbar.externalPickerFailed'), 5000);
    }
  }

  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent'
      ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`
      : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;

    this.dropdownEl.empty();

    const headerEl = this.dropdownEl.createDiv({ cls: 'pivi-external-context-header' });
    headerEl.setText(t('chat.toolbar.externalContexts'));

    const listEl = this.dropdownEl.createDiv({ cls: 'pivi-external-context-list' });
    const catalog = this.getCatalogPaths();

    if (catalog.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'pivi-external-context-empty' });
      emptyEl.setText(t('chat.toolbar.externalEmpty'));
    } else {
      for (const pathStr of catalog) {
        this.renderCatalogItem(listEl, pathStr);
      }
    }

    const addEl = this.dropdownEl.createDiv({ cls: 'pivi-external-context-add' });
    const addIconEl = addEl.createSpan({ cls: 'pivi-external-context-add-icon' });
    setIcon(addIconEl, 'folder-plus');
    addEl.createSpan({ text: t('chat.toolbar.externalAdd') });
    addEl.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.openFolderPicker();
    });
  }

  private renderCatalogItem(listEl: HTMLElement, pathStr: string): void {
    const itemEl = listEl.createDiv({ cls: 'pivi-external-context-item' });
    const checked = this.isChecked(pathStr);
    const pinned = this.isPinned(pathStr);
    const availability = validateDirectoryPath(pathStr);
    if (!pinned) itemEl.addClass('has-remove');

    itemEl.setAttribute('role', 'checkbox');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-checked', checked ? 'true' : 'false');
    itemEl.setAttribute(
      'aria-label',
      t('chat.toolbar.externalPathAria', { path: this.shortenPath(pathStr) }),
    );
    if (checked) {
      itemEl.addClass('enabled');
    }
    if (!availability.valid) {
      itemEl.addClass('unavailable');
    }

    const checkboxEl = itemEl.createEl('input', { cls: 'pivi-external-context-checkbox' });
    checkboxEl.type = 'checkbox';
    checkboxEl.checked = checked;
    checkboxEl.setAttribute('tabindex', '-1');

    const pathTextEl = itemEl.createSpan({ cls: 'pivi-external-context-text' });
    const displayPath = this.shortenPath(pathStr);
    pathTextEl.setText(displayPath);
    pathTextEl.setAttribute('title', pathStr);

    if (!availability.valid) {
      const warningEl = itemEl.createSpan({ cls: 'pivi-external-context-warning' });
      setIcon(warningEl, 'triangle-alert');
      const unavailableLabel = t('chat.toolbar.externalUnavailable', {
        reason: availability.error ?? '',
      });
      warningEl.setAttribute('aria-label', unavailableLabel);
      setTooltip(warningEl, unavailableLabel);
    }

    const pinBtn = itemEl.createSpan({ cls: 'pivi-external-context-action pivi-external-context-pin' });
    pinBtn.setAttribute('role', 'button');
    pinBtn.setAttribute('tabindex', '0');
    setIcon(pinBtn, pinned ? 'pin-off' : 'pin');
    const pinLabel = pinned
      ? t('chat.toolbar.externalUnpin', { path: displayPath })
      : t('chat.toolbar.externalPin', { path: displayPath });
    pinBtn.setAttribute('aria-label', pinLabel);
    setTooltip(pinBtn, pinLabel);
    const togglePin = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      this.togglePinned(pathStr);
    };
    pinBtn.addEventListener('click', togglePin);
    pinBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') togglePin(event);
    });

    if (!pinned) {
      const removeBtn = itemEl.createSpan({ cls: 'pivi-external-context-remove' });
      removeBtn.addClass('pivi-external-context-action');
      setIcon(removeBtn, 'x');
      removeBtn.setAttribute('role', 'button');
      removeBtn.setAttribute('tabindex', '0');
      removeBtn.setAttribute('title', t('chat.toolbar.externalRemove'));
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removePath(pathStr);
      });
    }

    const toggle = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.togglePath(pathStr);
    };
    itemEl.addEventListener('click', toggle);
    itemEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      toggle(e);
    });
  }

  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        const remainder = normalizedFull.slice(normalizedHome.length);
        return '~' + remainder;
      }
    } catch {
      // Fall through to return full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const selected = this.getExternalContexts();
    const availableCount = selected.filter((pathStr) => validateDirectoryPath(pathStr).valid).length;

    this.buttonEl.empty();
    const iconEl = this.buttonEl.createSpan({ cls: 'pivi-external-context-icon' });
    setIcon(iconEl, 'database-search');
    const countEl = this.buttonEl.createSpan({ cls: 'pivi-external-context-count' });
    countEl.setText(availableCount === selected.length
      ? String(selected.length)
      : `${availableCount}/${selected.length}`);
    if (availableCount !== selected.length) countEl.addClass('has-unavailable');
    if (selected.length > 0) {
      this.buttonEl.addClass('active');
    } else {
      this.buttonEl.removeClass('active');
    }
    this.buttonEl.setAttribute('title', selected.length > 0
      ? t('chat.toolbar.externalActiveTitle', { count: String(selected.length) })
      : t('chat.toolbar.externalIdleTitle'));
  }
}
