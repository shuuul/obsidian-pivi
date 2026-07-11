import {
  resolveSubagentWriterIconName,
  stableSubagentHash,
} from '../subagentProfiles';
import { WORKING_ICON_CLASS } from './workingIcon';

export const SUBAGENT_RUNNING_ICON_CLASS = 'pivi-subagent-running-icon';
export const SUBAGENT_COMPLETED_ICON_CLASS = 'pivi-subagent-completed-icon';

interface SubagentAnimatedIconDefinition {
  name: string;
  svgContent: string;
}

const DEFAULT_SUBAGENT_RUNNING_ICON: SubagentAnimatedIconDefinition = {
  name: 'waves',
  svgContent:
    '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/>'
    + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M2 12c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/>'
    + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M2 18c.6.5 1.2 1 2.5 1c2.5 0 2.5-2 5-2c2.6 0 2.4 2 5 2c2.5 0 2.5-2 5-2c1.3 0 1.9.5 2.5 1"/>',
};

const SUBAGENT_RUNNING_ICONS: readonly SubagentAnimatedIconDefinition[] = [
  DEFAULT_SUBAGENT_RUNNING_ICON,
  {
    name: 'wind',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M12.8 19.6A2 2 0 1 0 14 16H2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  },
  {
    name: 'tornado',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M21 4H3"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M18 8H6"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M19 12H9"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M16 16h-6"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-4" pathLength="1" d="M11 20H9"/>',
  },
  {
    name: 'tree',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Z"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M12 19v3"/>',
  },
  {
    name: 'telescope',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<path d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/>'
      + '<path d="m13.56 11.747 4.332-.924"/>'
      + '<path d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z"/>'
      + '<path d="m6.158 8.633 1.114 4.456"/>'
      + '</g>'
      + '<path d="m16 21-3.105-6.21"/>'
      + '<path d="m8 21 3.105-6.21"/>'
      + '<circle cx="12" cy="13" r="2"/>',
  },
  {
    name: 'stethoscope',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M11 2v2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M5 2v2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M8 15a6 6 0 0 0 12 0v-3"/>'
      + '<circle class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" cx="20" cy="10" r="2"/>',
  },
  {
    name: 'stamp',
    svgContent:
      '<path class="pivi-subagent-icon-motion pivi-subagent-icon-motion--stamp" d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>'
      + '<path class="pivi-subagent-icon-motion pivi-subagent-icon-motion--stamp" d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M5 22h14"/>',
  },
  {
    name: 'satellite-dish',
    svgContent:
      '<path d="M4 10a7.31 7.31 0 0 0 10 10Z"/>'
      + '<path d="m9 15 3-3"/>'
      + '<path class="pivi-subagent-signal pivi-subagent-signal--inner" d="M17 13a6 6 0 0 0-6-6"/>'
      + '<path class="pivi-subagent-signal pivi-subagent-signal--outer" d="M21 13A10 10 0 0 0 11 3"/>',
  },
  {
    name: 'rocking-chair',
    svgContent:
      '<polyline points="3.5 2 6.5 12.5 18 12.5"/>'
      + '<line x1="9.5" x2="5.5" y1="12.5" y2="20"/>'
      + '<line x1="15" x2="18.5" y1="12.5" y2="20"/>'
      + '<path d="M2.75 18a13 13 0 0 0 18.5 0"/>',
  },
  {
    name: 'pen-tool',
    svgContent:
      '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/>'
      + '<path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="m2.3 2.3 7.286 7.286"/>'
      + '<circle cx="11" cy="11" r="2"/>',
  },
  {
    name: 'heart-pulse',
    svgContent:
      '<g class="pivi-subagent-heart-shape">'
      + '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>'
      + '</g>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  },
  {
    name: 'feather',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/>'
      + '<path d="M16 8 2 22"/>'
      + '<path d="M17.5 15H9"/>'
      + '</g>',
  },
  {
    name: 'flame',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  },
  {
    name: 'compass',
    svgContent:
      '<circle class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" cx="12" cy="12" r="10"/>'
      + '<polygon class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway" points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  },
  {
    name: 'key',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/>'
      + '</g>',
  },
  {
    name: 'cat',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M12 5c.67 0 1.35.09 2 .26L18.5 2 18 7.62A9 9 0 1 1 5.96 7.63L5.5 2 9.7 5.3c.75-.2 1.52-.3 2.3-.3Zm0 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M9.5 11h.01"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M14.5 11h.01"/>',
  },
  {
    name: 'anchor',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M12 5V2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M12 22c5.52 0 10-4.48 10-10"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="M12 22C6.48 22 2 17.52 2 12"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M18 12h2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M4 12h2"/>'
      + '</g>',
  },
  {
    name: 'music',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M9 18V5l12-2v13"/>'
      + '<circle class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" cx="6" cy="18" r="3"/>'
      + '<circle class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" cx="18" cy="16" r="3"/>'
      + '</g>',
  },
  {
    name: 'swords',
    svgContent:
      '<g class="pivi-subagent-icon-motion pivi-subagent-icon-motion--sway">'
      + '<polyline class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>'
      + '<line class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" x1="13" x2="19" y1="19" y2="13"/>'
      + '<line class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" x1="16" x2="20" y1="16" y2="20"/>'
      + '<polyline class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" points="9.5 17.5 21 6 21 3 18 3 6.5 14.5"/>'
      + '<line class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" x1="11" x2="5" y1="19" y2="13"/>'
      + '<line class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" x1="8" x2="4" y1="16" y2="20"/>'
      + '</g>',
  },
  {
    name: 'scale',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M12 3v18"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="m19 8 3 8a5 5 0 0 1-6 0zV7"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="m5 8 3 8a5 5 0 0 1-6 0zV7"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M7 21h10"/>',
  },
  {
    name: 'flower-2',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"/>'
      + '<circle class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" cx="12" cy="8" r="2"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M12 10v12"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"/>',
  },
  {
    name: 'snowflake',
    svgContent:
      '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-0" pathLength="1" d="m10 20-1.25-2.5L6 18M10 4 8.75 6.5 6 6m8 14 1.25-2.5L18 18m-4-14 1.25 2.5L18 6"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-1" pathLength="1" d="m17 21-3-6h-4M17 3l-3 6 1.5 3"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-2" pathLength="1" d="M2 12h6.5L10 9m10 1-1.5 2 1.5 2m2-2h-6.5L14 15m-10-5 1.5 2L4 14"/>'
      + '<path class="pivi-subagent-icon-stroke pivi-subagent-icon-stroke--delay-3" pathLength="1" d="m7 21 3-6-1.5-3M7 3l3 6h4"/>',
  },
];

const SUBAGENT_COMPLETED_ICON_CONTENT =
  '<path class="pivi-subagent-completed-user" d="M2 21a8 8 0 0 1 13.292-6"/>'
  + '<circle class="pivi-subagent-completed-user" cx="10" cy="8" r="5"/>'
  + '<path class="pivi-subagent-completed-check" pathLength="1" d="m16 19 2 2 4-4"/>';

function createLucideSvg(svgContent: string): SVGSVGElement | null {
  if (typeof DOMParser === 'undefined') {
    return null;
  }
  const fullSvgString = '<svg class="pivi-subagent-animated-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + svgContent
    + '</svg>';
  const parser = new DOMParser();
  const doc = parser.parseFromString(fullSvgString, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  return svg;
}

function resolveSubagentRunningIcon(id: string, writerName?: string): SubagentAnimatedIconDefinition {
  const writerIconName = resolveSubagentWriterIconName(writerName);
  const writerIcon = writerIconName
    ? SUBAGENT_RUNNING_ICONS.find((icon) => icon.name === writerIconName)
    : undefined;
  if (writerIcon) return writerIcon;
  return SUBAGENT_RUNNING_ICONS[stableSubagentHash(id) % SUBAGENT_RUNNING_ICONS.length]
    ?? DEFAULT_SUBAGENT_RUNNING_ICON;
}

export function clearSubagentAnimatedIcon(el: HTMLElement): void {
  el.removeClass(WORKING_ICON_CLASS);
  el.removeClass(SUBAGENT_RUNNING_ICON_CLASS);
  el.removeClass(SUBAGENT_COMPLETED_ICON_CLASS);
  for (const icon of SUBAGENT_RUNNING_ICONS) {
    el.removeClass(`pivi-subagent-running-icon--${icon.name}`);
  }
}

function prepareSubagentAnimatedIcon(el: HTMLElement): void {
  el.empty();
  clearSubagentAnimatedIcon(el);
  el.addClass(WORKING_ICON_CLASS);
  el.setAttribute('aria-hidden', 'true');
}

export function appendSubagentRunningIcon(el: HTMLElement, id: string, writerName?: string): void {
  const icon = resolveSubagentRunningIcon(id, writerName);
  prepareSubagentAnimatedIcon(el);
  el.addClass(SUBAGENT_RUNNING_ICON_CLASS);
  el.addClass(`pivi-subagent-running-icon--${icon.name}`);
  const svg = createLucideSvg(icon.svgContent);
  if (svg) {
    el.appendChild(svg);
  }
}

export function appendSubagentCompletedIcon(el: HTMLElement): void {
  prepareSubagentAnimatedIcon(el);
  el.addClass(SUBAGENT_COMPLETED_ICON_CLASS);
  const svg = createLucideSvg(SUBAGENT_COMPLETED_ICON_CONTENT);
  if (svg) {
    el.appendChild(svg);
  }
}
