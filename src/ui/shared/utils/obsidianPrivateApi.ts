/**
 * Centralized Obsidian and browser private-API casts.
 * Review this module when upgrading Obsidian or CodeMirror integrations.
 */

import type { EditorView } from '@codemirror/view';
import type { App, Editor, ItemView, TAbstractFile } from 'obsidian';

export type CustomHighlightRegistry = {
  delete: (name: string) => boolean;
  set: (name: string, highlight: unknown) => void;
};

export type CustomHighlightConstructor = new (...ranges: Range[]) => unknown;

/** Reads the CSS Highlight API registry when the host browser exposes it. */
export function getCssHighlights(): CustomHighlightRegistry | null {
  const css = typeof CSS === 'undefined'
    ? null
    : CSS as unknown as { highlights?: CustomHighlightRegistry };
  return css?.highlights ?? null;
}

/** Resolves the Highlight constructor from the owner window or renderer fallback. */
export function getHighlightConstructor(ownerWindow: Window | null): CustomHighlightConstructor | null {
  const ownerHighlight = ownerWindow as unknown as {
    Highlight?: CustomHighlightConstructor;
  } | null;
  const rendererWindow = typeof window === 'undefined'
    ? null
    : window as unknown as { Highlight?: CustomHighlightConstructor };
  return ownerHighlight?.Highlight ?? rendererWindow?.Highlight ?? null;
}

/** Gets the CodeMirror EditorView from an Obsidian Editor. */
export function getEditorCmView(editor: Editor): EditorView | undefined {
  return (editor as unknown as { cm?: EditorView }).cm;
}

/** Reads ItemView.containerEl when the public type omits it. */
export function getItemViewContainerEl(view: ItemView | undefined): HTMLElement | undefined {
  if (!view) return undefined;
  return (view as unknown as { containerEl?: HTMLElement }).containerEl;
}

/** Reads a legacy title property some browser-like ItemView implementations expose. */
export function getItemViewTitleProperty(view: ItemView): string | undefined {
  const title = (view as unknown as { title?: unknown }).title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

/** Exposes URL-like private fields on browser-like ItemView implementations. */
export function getItemViewUrlRecord(view: ItemView): Record<string, unknown> {
  return view as unknown as Record<string, unknown>;
}

/** Resolves Event from a specific owner window for pop-out-safe DOM events. */
export function getOwnerWindowEventConstructor(ownerWindow: Window): typeof Event {
  return (ownerWindow as unknown as { Event: typeof Event }).Event;
}

/** Obsidian 1.13 native page links have no public programmatic navigation API. */
export function openNativeSettingsPage(app: App, tabId: string, pageName: string): boolean {
  type Item = { def?: { type?: string; name?: string }; settingEl?: HTMLElement; children?: Item[] };
  const setting = (app as App & { setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
    clearPageStack?: () => void;
    activeTab?: { renderedItems?: Item[] };
  } }).setting;
  if (!setting?.open || !setting.openTabById) return false;
  setting.open();
  setting.clearPageStack?.();
  setting.openTabById(tabId);
  const find = (items: Item[]): HTMLElement | undefined => {
    for (const item of items) {
      if (item.def?.type === 'page' && item.def.name === pageName) return item.settingEl;
      const nested = item.children && find(item.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const entry = find(setting.activeTab?.renderedItems ?? []);
  if (!entry) return false;
  entry.click();
  return true;
}

/** Reveal/expand a folder without opening or replacing a document leaf. */
export async function revealFolderInExplorer(app: App, folder: TAbstractFile): Promise<boolean> {
  const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
  if (!leaf) return false;
  await app.workspace.revealLeaf(leaf);
  const view = leaf.view as unknown as {
    revealInFolder?: (file: TAbstractFile) => void;
    fileItems?: Record<string, { setCollapsed?: (collapsed: boolean) => void }>;
  };
  if (!view.revealInFolder) return false;
  view.revealInFolder(folder);
  view.fileItems?.[folder.path]?.setCollapsed?.(false);
  return true;
}
