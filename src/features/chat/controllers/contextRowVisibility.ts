export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.obsius2-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.obsius2-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.obsius2-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.obsius2-file-indicator');
  const imagePreview = contextRowEl.querySelector('.obsius2-image-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('obsius2-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('obsius2-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('obsius2-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('obsius2-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('obsius2-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection || hasBrowserSelection || hasCanvasSelection || hasFileChips || hasImageChips
  );
}
