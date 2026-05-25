/** Resolve the document for a plugin-owned element (popout-safe). */
export function getActiveDocument(el?: HTMLElement | null): Document {
  return el?.ownerDocument ?? activeDocument;
}

/** Resolve the window for a plugin-owned element (popout-safe). */
export function getActiveWindow(el?: HTMLElement | null): Window {
  return el?.ownerDocument?.defaultView ?? activeWindow;
}
