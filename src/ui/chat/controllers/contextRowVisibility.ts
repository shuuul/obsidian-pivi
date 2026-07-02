export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.pivi-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.pivi-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.pivi-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.pivi-file-indicator');
  const imagePreview = contextRowEl.querySelector('.pivi-image-preview');
  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('pivi-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('pivi-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('pivi-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('pivi-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('pivi-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection
      || hasBrowserSelection
      || hasCanvasSelection
      || hasFileChips
      || hasImageChips
  );
}
