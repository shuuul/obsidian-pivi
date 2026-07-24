import type { ChatIconSvg, ChatSvgChild } from '@pivi/pivi-agent-core/foundation';

import piviIconSvg from '../../../../assets/icons/pivi-p.svg';

const PIVI_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(piviIconSvg)}`;

const MCP_ICON_PATHS = [
  'M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z',
  'M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z',
];

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  ownerDocument: Document,
  tagName: K,
): SVGElementTagNameMap[K] {
  return ownerDocument.win.createSvg(tagName);
}

export function appendMcpIcon(container: HTMLElement): void {
  container.empty();

  const svg = createSvgElement(container.ownerDocument, 'svg');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('height', '1em');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');

  const title = createSvgElement(container.ownerDocument, 'title');
  title.textContent = 'MCP';
  svg.appendChild(title);

  for (const pathData of MCP_ICON_PATHS) {
    const path = createSvgElement(container.ownerDocument, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
  }

  container.appendChild(svg);
}

export function appendCheckIcon(container: HTMLElement): void {
  container.empty();

  const svg = createSvgElement(container.ownerDocument, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const polyline = createSvgElement(container.ownerDocument, 'polyline');
  polyline.setAttribute('points', '20 6 9 17 4 12');
  svg.appendChild(polyline);

  container.appendChild(svg);
}

/** Pi agent / Pivi brand icon. */
export const PI_CHAT_ICON: ChatIconSvg = {
  kind: 'pivi-brand',
  viewBox: '0 0 512 512',
};

function createPiviBrandIconSvg(ownerDocument: Document): SVGElement {
  const svg = createSvgElement(ownerDocument, 'svg');
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('aria-hidden', 'true');
  const image = createSvgElement(ownerDocument, 'image');
  image.setAttribute('href', PIVI_ICON_DATA_URI);
  image.setAttribute('height', '512');
  image.setAttribute('width', '512');
  svg.appendChild(image);
  return svg;
}


export interface CreateChatIconSvgOptions {
  className?: string;
  height?: number | string;
  ownerDocument?: Document;
  width?: number | string;
}

export function createChatIconSvg(
  icon: ChatIconSvg,
  options: CreateChatIconSvgOptions = {},
): SVGElement {
  const ownerDocument = options.ownerDocument ?? window.document;
  const svg = icon.kind === 'pivi-brand'
    ? createPiviBrandIconSvg(ownerDocument)
    : ownerDocument.win.createSvg('svg');

  if (icon.kind !== 'pivi-brand') {
    svg.setAttribute('viewBox', icon.viewBox);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
  }

  svg.classList.add(icon.kind === 'pivi-brand' ? 'pivi-brand-icon' : 'pivi-provider-icon');

  if (options.width !== undefined) {
    svg.setAttribute('width', String(options.width));
  }
  if (options.height !== undefined) {
    svg.setAttribute('height', String(options.height));
  }
  if (options.className) {
    svg.classList.add(...options.className.split(/\s+/).filter(Boolean));
  }

  if (icon.kind === 'pivi-brand') {
    return svg;
  }

  if (icon.kind === 'composite') {
    for (const child of icon.children) {
      svg.appendChild(createChatSvgChild(child, ownerDocument));
    }
    return svg;
  }

  const path = ownerDocument.win.createSvg('path');
  path.setAttribute('d', icon.path);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function createChatSvgChild(child: ChatSvgChild, ownerDocument: Document): SVGElement {
  const element = ownerDocument.win.createSvg(child.tag);
  for (const [name, value] of Object.entries(child.attributes)) {
    element.setAttribute(name, value);
  }

  if (child.tag === 'g') {
    for (const nestedChild of child.children) {
      element.appendChild(createChatSvgChild(nestedChild, ownerDocument));
    }
  }

  return element;
}
