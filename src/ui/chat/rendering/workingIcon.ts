/** Lightweight running indicator (CSS/SVG only, no deps). */
export const WORKING_ICON_CLASS = 'pivi-working-icon';

export function appendWorkingIcon(el: HTMLElement): void {
  el.empty();
  el.addClass(WORKING_ICON_CLASS);
  el.setAttribute('aria-hidden', 'true');

  const svg = el.createSvg('svg', {
    attr: {
      viewBox: '0 0 16 16',
      width: '16',
      height: '16',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
  });

  svg.createSvg('circle', {
    cls: 'pivi-working-icon-track',
    attr: {
      cx: '8',
      cy: '8',
      r: '6',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      opacity: '0.25',
    },
  });

  svg.createSvg('path', {
    cls: 'pivi-working-icon-arc',
    attr: {
      d: 'M8 2a6 6 0 0 1 6 6',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
    },
  });
}
