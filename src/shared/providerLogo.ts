import { setIcon } from 'obsidian';

import type { ChatIconSvg, ChatUIOption } from '../core/agent/types';
import { createChatIconSvg } from './icons';

export const PROVIDER_LOGO_CDN_BASE =
  'https://unpkg.com/@lobehub/icons-static-svg@latest/icons';

const preloadedUrls = new Set<string>();

export function getProviderLogoUrl(slug: string): string {
  return `${PROVIDER_LOGO_CDN_BASE}/${slug}.svg`;
}

/** Preload provider logo SVGs into the browser cache. */
export function preloadProviderLogos(slugs: string[]): void {
  for (const slug of slugs) {
    const url = getProviderLogoUrl(slug);
    if (preloadedUrls.has(url)) {
      continue;
    }
    preloadedUrls.add(url);
    const img = new Image();
    img.src = url;
  }
}

export interface AppendProviderLogoOptions {
  size?: number;
  className?: string;
}

/**
 * Appends a mask-based brand logo that inherits currentColor (light/dark safe).
 */
export function appendProviderLogo(
  parent: HTMLElement,
  slug: string,
  options: AppendProviderLogoOptions = {},
): HTMLElement {
  const size = options.size ?? 14;
  const classes = ['pivi-provider-logo-mask'];
  if (options.className) {
    classes.push(options.className);
  }
  const el = parent.createSpan({
    cls: classes.join(' '),
    attr: { 'aria-hidden': 'true' },
  });
  const url = getProviderLogoUrl(slug);
  if (size !== 14) {
    el.style.setProperty('--pivi-provider-logo-size', `${size}px`);
  }
  // CDN URL is dynamic per provider; mask inherits currentColor via CSS.
  el.style.setProperty('-webkit-mask-image', `url(${url})`);
  el.style.setProperty('mask-image', `url(${url})`);
  return el;
}

export interface AppendModelOptionIconOptions {
  size?: number;
  className?: string;
  fallbackChatIcon?: ChatIconSvg;
}

type ModelIconFields = Pick<ChatUIOption, 'providerLogoSlug' | 'chatIcon' | 'fallbackIcon'>;

/**
 * Renders provider brand logo, inline chat icon, or Lucide fallback for a model option.
 */
export function appendModelOptionIcon(
  parent: HTMLElement,
  option: ModelIconFields,
  iconOptions: AppendModelOptionIconOptions = {},
): HTMLElement | SVGElement | null {
  const size = iconOptions.size ?? 12;
  const className = iconOptions.className ?? 'pivi-model-provider-icon';

  if (option.providerLogoSlug) {
    return appendProviderLogo(parent, option.providerLogoSlug, { size, className });
  }

  const chatIcon = option.chatIcon ?? iconOptions.fallbackChatIcon;
  if (chatIcon) {
    const svg = createChatIconSvg(chatIcon, {
      className,
      height: size,
      ownerDocument: parent.ownerDocument,
      width: size,
    });
    parent.appendChild(svg);
    return svg;
  }

  const lucide = option.fallbackIcon ?? 'cpu';
  const iconHost = parent.createSpan({ cls: className });
  setIcon(iconHost, lucide);
  return iconHost;
}
