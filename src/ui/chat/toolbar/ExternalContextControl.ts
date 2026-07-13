import * as os from 'os';
import * as path from 'path';

import { expandHomePath, normalizePathForFilesystem } from '@/app/hostPlatform';

import {
  findConflictingPath,
  isDuplicatePath,
  normalizePathForComparison,
  validateDirectoryPath,
} from '../../shared/utils/externalContext';

export type AddExternalContextResult =
  | { success: true; normalizedPath: string }
  | { success: false; error: string };

export interface ExternalContextItemSnapshot {
  readonly path: string;
  readonly displayPath: string;
  readonly checked: boolean;
  readonly pinned: boolean;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

export interface ExternalContextSnapshot {
  readonly items: readonly ExternalContextItemSnapshot[];
  readonly selectedCount: number;
  readonly availableSelectedCount: number;
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter(pathValue => {
    const key = normalizePathForComparison(pathValue);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Runtime-only external-context state. Presentation is owned by the React composer portal. */
export class ExternalContextSelector {
  private pinnedPaths: string[] = [];
  private sessionPaths: string[] = [];
  private selectedPathKeys = new Set<string>();
  private onPinnedChangeCallback: ((paths: string[]) => void | Promise<void>) | null = null;
  private onChangeCallback: ((snapshot: ExternalContextSnapshot) => void) | null = null;

  setOnPinnedChange(callback: (paths: string[]) => void | Promise<void>): void {
    this.onPinnedChangeCallback = callback;
  }

  setOnChange(callback: (snapshot: ExternalContextSnapshot) => void): void {
    this.onChangeCallback = callback;
    callback(this.getSnapshot());
  }

  getSnapshot(): ExternalContextSnapshot {
    const items = this.getCatalogPaths().map(pathValue => {
      const availability = validateDirectoryPath(pathValue);
      return {
        path: pathValue,
        displayPath: this.shortenPath(pathValue),
        checked: this.isChecked(pathValue),
        pinned: this.isPinned(pathValue),
        available: availability.valid,
        unavailableReason: availability.error ?? null,
      };
    });
    const selected = items.filter(item => item.checked);
    return { items, selectedCount: selected.length, availableSelectedCount: selected.filter(item => item.available).length };
  }

  getExternalContexts(): string[] { return this.getCatalogPaths().filter(pathValue => this.isChecked(pathValue)); }
  getPinnedPaths(): string[] { return [...this.pinnedPaths]; }

  setPinnedPaths(paths: string[]): void {
    const previous = new Set(this.pinnedPaths.map(normalizePathForComparison));
    const next = uniqueNormalizedPaths(paths);
    const nextKeys = new Set(next.map(normalizePathForComparison));
    for (const pathValue of next) if (!previous.has(normalizePathForComparison(pathValue))) this.selectedPathKeys.add(normalizePathForComparison(pathValue));
    this.sessionPaths = this.sessionPaths.filter(pathValue => !nextKeys.has(normalizePathForComparison(pathValue)));
    this.pinnedPaths = next;
    this.emit();
  }

  resetForSession(pinnedPaths: string[]): void {
    this.pinnedPaths = uniqueNormalizedPaths(pinnedPaths);
    this.sessionPaths = [];
    this.selectedPathKeys = new Set(this.pinnedPaths.map(normalizePathForComparison));
    this.emit();
  }

  togglePath(pathValue: string): void {
    const key = normalizePathForComparison(pathValue);
    this.selectedPathKeys.has(key) ? this.selectedPathKeys.delete(key) : this.selectedPathKeys.add(key);
    this.emit();
  }

  removePath(pathValue: string): void {
    this.sessionPaths = this.sessionPaths.filter(item => normalizePathForComparison(item) !== normalizePathForComparison(pathValue));
    this.selectedPathKeys.delete(normalizePathForComparison(pathValue));
    this.emit();
  }

  togglePinned(pathValue: string): void {
    const key = normalizePathForComparison(pathValue);
    if (this.isPinned(pathValue)) {
      this.pinnedPaths = this.pinnedPaths.filter(item => normalizePathForComparison(item) !== key);
      this.sessionPaths = uniqueNormalizedPaths([...this.sessionPaths, pathValue]);
    } else {
      this.sessionPaths = this.sessionPaths.filter(item => normalizePathForComparison(item) !== key);
      this.pinnedPaths = uniqueNormalizedPaths([...this.pinnedPaths, pathValue]);
    }
    void this.onPinnedChangeCallback?.([...this.pinnedPaths]);
    this.emit();
  }

  addExternalContext(pathInput: string): AddExternalContextResult {
    const trimmed = pathInput?.trim();
    if (!trimmed) return { success: false, error: 'No path provided.' };
    let cleanPath = trimmed;
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) || (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) cleanPath = cleanPath.slice(1, -1);
    const normalizedPath = normalizePathForFilesystem(expandHomePath(cleanPath));
    if (!path.isAbsolute(normalizedPath)) return { success: false, error: 'Path must be absolute.' };
    const validation = validateDirectoryPath(normalizedPath);
    if (!validation.valid) return { success: false, error: `${validation.error}: ${pathInput}` };
    const catalog = this.getCatalogPaths();
    if (isDuplicatePath(normalizedPath, catalog)) return { success: false, error: 'This folder is already added as an external context.' };
    const conflict = findConflictingPath(normalizedPath, catalog);
    if (conflict) return { success: false, error: this.formatConflictMessage(normalizedPath, conflict) };
    this.sessionPaths = uniqueNormalizedPaths([...this.sessionPaths, normalizedPath]);
    this.selectedPathKeys.add(normalizePathForComparison(normalizedPath));
    this.emit();
    return { success: true, normalizedPath };
  }

  private emit(): void { this.onChangeCallback?.(this.getSnapshot()); }
  private isPinned(pathValue: string): boolean { return this.pinnedPaths.some(item => normalizePathForComparison(item) === normalizePathForComparison(pathValue)); }
  private isChecked(pathValue: string): boolean { return this.selectedPathKeys.has(normalizePathForComparison(pathValue)); }
  private getCatalogPaths(): string[] { return uniqueNormalizedPaths([...this.pinnedPaths, ...this.sessionPaths]); }
  private formatConflictMessage(newPath: string, conflict: { path: string; type: 'parent' | 'child' }): string {
    const shortNew = this.shortenPath(newPath); const shortExisting = this.shortenPath(conflict.path);
    return conflict.type === 'parent' ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"` : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
  }
  private shortenPath(fullPath: string): string {
    try {
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath); const normalizedHome = normalize(os.homedir());
      const compare = process.platform === 'win32' ? normalizedFull.toLowerCase() : normalizedFull;
      const compareHome = process.platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome;
      if (compare.startsWith(compareHome)) return `~${normalizedFull.slice(normalizedHome.length)}`;
    } catch { /* use the full path */ }
    return fullPath;
  }
}
