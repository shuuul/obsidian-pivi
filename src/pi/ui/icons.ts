import type { ChatIconSvg, ChatSvgChild } from '../agent/types';

export const MCP_ICON_SVG = `<svg fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>MCP</title><path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path><path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path></svg>`;

export const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MCP_ICON_PATHS = [
  'M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z',
  'M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z',
];

function createSvgElement(ownerDocument: Document, tagName: string): SVGElement {
  return ownerDocument.createElementNS(SVG_NS, tagName);
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

/** Pi agent / Pivi brand p — same mask geometry as ribbon `pivi-p`. */
export const PI_CHAT_ICON: ChatIconSvg = {
  kind: 'pivi-brand',
  viewBox: '0 0 100 100',
};

let piviBrandMaskCounter = 0;

function createPiviBrandIconSvg(ownerDocument: Document): SVGElement {
  const maskId = `pivi-brand-cutout-${++piviBrandMaskCounter}`;
  const svg = createSvgElement(ownerDocument, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const defs = createSvgElement(ownerDocument, 'defs');
  const mask = createSvgElement(ownerDocument, 'mask');
  mask.setAttribute('id', maskId);

  const maskBg = createSvgElement(ownerDocument, 'rect');
  maskBg.setAttribute('width', '100');
  maskBg.setAttribute('height', '100');
  maskBg.setAttribute('fill', 'black');
  mask.appendChild(maskBg);

  const stem = createSvgElement(ownerDocument, 'rect');
  stem.setAttribute('x', '23');
  stem.setAttribute('y', '14');
  stem.setAttribute('width', '18');
  stem.setAttribute('height', '72');
  stem.setAttribute('rx', '9');
  stem.setAttribute('fill', 'white');
  mask.appendChild(stem);

  const bowl = createSvgElement(ownerDocument, 'g');
  bowl.setAttribute('transform', 'rotate(18 56 35)');
  const bowlEllipse = createSvgElement(ownerDocument, 'ellipse');
  bowlEllipse.setAttribute('cx', '56');
  bowlEllipse.setAttribute('cy', '35');
  bowlEllipse.setAttribute('rx', '31');
  bowlEllipse.setAttribute('ry', '25');
  bowlEllipse.setAttribute('fill', 'white');
  bowl.appendChild(bowlEllipse);
  mask.appendChild(bowl);

  const innerCutout = createSvgElement(ownerDocument, 'g');
  innerCutout.setAttribute('transform', 'rotate(-20 58 36)');
  const innerEllipse = createSvgElement(ownerDocument, 'ellipse');
  innerEllipse.setAttribute('cx', '58');
  innerEllipse.setAttribute('cy', '36');
  innerEllipse.setAttribute('rx', '14');
  innerEllipse.setAttribute('ry', '11');
  innerEllipse.setAttribute('fill', 'black');
  innerCutout.appendChild(innerEllipse);
  mask.appendChild(innerCutout);

  defs.appendChild(mask);
  svg.appendChild(defs);

  const fill = createSvgElement(ownerDocument, 'rect');
  fill.setAttribute('width', '100');
  fill.setAttribute('height', '100');
  fill.setAttribute('fill', 'currentColor');
  fill.setAttribute('mask', `url(#${maskId})`);
  svg.appendChild(fill);

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
    : ownerDocument.createElementNS(SVG_NS, 'svg');

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

  const path = ownerDocument.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', icon.path);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function createChatSvgChild(child: ChatSvgChild, ownerDocument: Document): SVGElement {
  const element = ownerDocument.createElementNS(SVG_NS, child.tag);
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
