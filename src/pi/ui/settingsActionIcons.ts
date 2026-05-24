/** Inline SVG icons for settings action buttons (Obsidian createEl, no innerHTML). */
export function appendRefreshIcon(button: HTMLElement): void {
  const svg = button.createEl('svg', {
    attr: {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    },
  });
  svg.createEl('path', { attr: { d: 'M21 12a9 9 0 1 1-2.64-6.36' } });
  svg.createEl('path', { attr: { d: 'M21 3v6h-6' } });
}

export function appendTrashIcon(button: HTMLElement): void {
  const svg = button.createEl('svg', {
    attr: {
      xmlns: 'http://www.w3.org/2000/svg',
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    },
  });
  for (const d of ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6']) {
    svg.createEl('path', { attr: { d } });
  }
}
