/** Inline SVG icons for settings action buttons (no innerHTML). */
const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function appendRefreshIcon(button: HTMLElement): void {
  button.append(
    createSvgIcon([
      'M21 12a9 9 0 1 1-2.64-6.36',
      'M21 3v6h-6',
    ]),
  );
}

export function appendTrashIcon(button: HTMLElement): void {
  button.append(
    createSvgIcon([
      'M3 6h18',
      'M8 6V4h8v2',
      'M19 6l-1 14H6L5 6',
    ]),
  );
}
