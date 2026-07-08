import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg';
import googleSvg from '@lobehub/icons-static-svg/icons/google.svg';
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg';
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg';
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg';
import xiaomiMiMoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import zaiSvg from '@lobehub/icons-static-svg/icons/zai.svg';
import type { ChatIconSvg, ChatUIOption } from '@pivi/pivi-agent-core/foundation';
import { setIcon } from 'obsidian';

import { createChatIconSvg } from './icons';

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const LOBE_PROVIDER_LOGO_DATA_URI: Record<string, string> = {
  anthropic: svgToDataUri(anthropicSvg),
  deepseek: svgToDataUri(deepseekSvg),
  google: svgToDataUri(googleSvg),
  kimi: svgToDataUri(kimiSvg),
  minimax: svgToDataUri(minimaxSvg),
  moonshot: svgToDataUri(moonshotSvg),
  openai: svgToDataUri(openaiSvg),
  opencode: svgToDataUri(opencodeSvg),
  openrouter: svgToDataUri(openrouterSvg),
  xiaomimimo: svgToDataUri(xiaomiMiMoSvg),
  zai: svgToDataUri(zaiSvg),
};

function getProviderLogoFallbackIcon(slug: string): string {
  if (slug.includes('github') || slug.includes('opencode')) return 'github';
  if (slug.includes('google')) return 'sparkles';
  if (slug.includes('bedrock') || slug.includes('amazon')) return 'cloud';
  if (slug.includes('azure') || slug.includes('cloudflare')) return 'cloud-cog';
  if (slug.includes('openai') || slug.includes('anthropic')) return 'bot';
  return 'cpu';
}

export interface AppendProviderLogoOptions {
  size?: number;
  className?: string;
}

/**
 * Appends a bundled lobe-icons provider logo mask, falling back to a local Lucide icon.
 *
 * Obsidian community review prefers bundled/local UI assets over runtime CDN
 * fetches, so provider logos come from @lobehub/icons-static-svg at build time.
 */
export function appendProviderLogo(
  parent: HTMLElement,
  slug: string,
  options: AppendProviderLogoOptions = {},
): HTMLElement {
  const size = options.size ?? 14;
  const dataUri = LOBE_PROVIDER_LOGO_DATA_URI[slug];
  const classes = [dataUri ? 'pivi-provider-logo-mask' : 'pivi-provider-logo-lucide'];
  if (options.className) {
    classes.push(options.className);
  }
  const el = parent.createSpan({
    cls: classes.join(' '),
    attr: { 'aria-hidden': 'true' },
  });
  if (size !== 14) {
    el.style.setProperty('--pivi-provider-logo-size', `${size}px`);
  }
  if (dataUri) {
    el.style.setProperty('-webkit-mask-image', `url("${dataUri}")`);
    el.style.setProperty('mask-image', `url("${dataUri}")`);
  } else {
    setIcon(el, getProviderLogoFallbackIcon(slug));
  }
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
