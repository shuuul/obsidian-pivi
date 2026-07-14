/**
 * Centralized Obsidian and browser private-API casts.
 * Review this module when upgrading Obsidian or CodeMirror integrations.
 */

import type { EditorView } from '@codemirror/view';
import type { Editor, ItemView } from 'obsidian';

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

/** Resolves InputEvent from a specific owner window for pop-out-safe DOM events. */
export function getOwnerWindowInputEventConstructor(
  ownerWindow: Window,
): typeof InputEvent | undefined {
  return (ownerWindow as unknown as { InputEvent?: typeof InputEvent }).InputEvent;
}

/** Resolves Event from a specific owner window for pop-out-safe DOM events. */
export function getOwnerWindowEventConstructor(ownerWindow: Window): typeof Event {
  return (ownerWindow as unknown as { Event: typeof Event }).Event;
}
