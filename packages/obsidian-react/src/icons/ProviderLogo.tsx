import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg';
import googleSvg from '@lobehub/icons-static-svg/icons/google.svg';
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg';
import lmstudioSvg from '@lobehub/icons-static-svg/icons/lmstudio.svg';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg';
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg';
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg';
import xiaomiMiMoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import zaiSvg from '@lobehub/icons-static-svg/icons/zai.svg';
import { setIcon } from 'obsidian';
import { type CSSProperties, useEffect, useRef } from 'react';

import llamaCppSvg from '../../../../assets/icons/llama-cpp.svg';

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** pi-ai/custom provider logo slug → bundled lobe-icons SVG data URI. */
export const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  anthropic: svgToDataUri(anthropicSvg),
  deepseek: svgToDataUri(deepseekSvg),
  google: svgToDataUri(googleSvg),
  kimi: svgToDataUri(kimiSvg),
  lmstudio: svgToDataUri(lmstudioSvg),
  'llama-cpp': svgToDataUri(llamaCppSvg),
  minimax: svgToDataUri(minimaxSvg),
  moonshot: svgToDataUri(moonshotSvg),
  ollama: svgToDataUri(ollamaSvg),
  openai: svgToDataUri(openaiSvg),
  opencode: svgToDataUri(opencodeSvg),
  openrouter: svgToDataUri(openrouterSvg),
  xiaomimimo: svgToDataUri(xiaomiMiMoSvg),
  zai: svgToDataUri(zaiSvg),
};

/** Lucide fallback icon name for a provider slug without a bundled brand mark. */
export function providerFallbackIcon(slug: string): string {
  if (slug.includes('github') || slug.includes('opencode')) return 'github';
  if (slug.includes('google')) return 'sparkles';
  if (slug.includes('bedrock') || slug.includes('amazon')) return 'cloud';
  if (slug.includes('azure') || slug.includes('cloudflare')) return 'cloud-cog';
  if (slug.includes('openai') || slug.includes('anthropic')) return 'bot';
  return 'cpu';
}

/** Lucide icon rendered through Obsidian's `setIcon`. */
export function LucideIcon({ className, name }: { readonly className: string; readonly name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span aria-hidden="true" className={className} ref={ref} />;
}

export interface ProviderLogoProps {
  readonly slug: string;
  readonly size: number;
  readonly className?: string;
}

/**
 * Provider brand mark rendered as a CSS mask so it inherits `currentColor`.
 * Falls back to a themed Lucide glyph when the slug has no bundled SVG.
 */
export function ProviderLogo({ slug, size, className }: ProviderLogoProps) {
  const dataUri = PROVIDER_LOGOS[slug];
  if (dataUri) {
    const style = {
      '--pivi-provider-logo-size': `${size}px`,
      WebkitMaskImage: `url("${dataUri}")`,
      maskImage: `url("${dataUri}")`,
    } as CSSProperties;
    return (
      <span
        aria-hidden="true"
        className={className ? `pivi-provider-logo-mask ${className}` : 'pivi-provider-logo-mask'}
        style={style}
      />
    );
  }
  return <LucideIcon className={className ?? ''} name={providerFallbackIcon(slug)} />;
}
