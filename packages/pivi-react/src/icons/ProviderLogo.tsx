import anthropicSvg from '@lobehub/icons-static-svg/icons/anthropic.svg';
import braveSvg from '@lobehub/icons-static-svg/icons/brave.svg';
import deepseekSvg from '@lobehub/icons-static-svg/icons/deepseek.svg';
import doubaoSvg from '@lobehub/icons-static-svg/icons/doubao.svg';
import exaSvg from '@lobehub/icons-static-svg/icons/exa.svg';
import geminiSvg from '@lobehub/icons-static-svg/icons/gemini.svg';
import gemmaSvg from '@lobehub/icons-static-svg/icons/gemma.svg';
import googleSvg from '@lobehub/icons-static-svg/icons/google.svg';
import hunyuanSvg from '@lobehub/icons-static-svg/icons/hunyuan.svg';
import internlmSvg from '@lobehub/icons-static-svg/icons/internlm.svg';
import kimiSvg from '@lobehub/icons-static-svg/icons/kimi.svg';
import lmstudioSvg from '@lobehub/icons-static-svg/icons/lmstudio.svg';
import metaSvg from '@lobehub/icons-static-svg/icons/meta.svg';
import microsoftSvg from '@lobehub/icons-static-svg/icons/microsoft.svg';
import minimaxSvg from '@lobehub/icons-static-svg/icons/minimax.svg';
import mistralSvg from '@lobehub/icons-static-svg/icons/mistral.svg';
import moonshotSvg from '@lobehub/icons-static-svg/icons/moonshot.svg';
import nvidiaSvg from '@lobehub/icons-static-svg/icons/nvidia.svg';
import ollamaSvg from '@lobehub/icons-static-svg/icons/ollama.svg';
import openaiSvg from '@lobehub/icons-static-svg/icons/openai.svg';
import opencodeSvg from '@lobehub/icons-static-svg/icons/opencode.svg';
import openrouterSvg from '@lobehub/icons-static-svg/icons/openrouter.svg';
import qwenSvg from '@lobehub/icons-static-svg/icons/qwen.svg';
import tavilySvg from '@lobehub/icons-static-svg/icons/tavily.svg';
import xaiSvg from '@lobehub/icons-static-svg/icons/xai.svg';
import xiaomiMiMoSvg from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import yiSvg from '@lobehub/icons-static-svg/icons/yi.svg';
import zaiSvg from '@lobehub/icons-static-svg/icons/zai.svg';
import { type CSSProperties, useEffect, useRef } from 'react';

import anysearchSvg from '../../../../assets/icons/anysearch.svg';
import llamaCppSvg from '../../../../assets/icons/llama-cpp.svg';
import { usePresentationPlatform } from '../platform';

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Provider logo slug → bundled SVG data URI. */
export const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  anthropic: svgToDataUri(anthropicSvg),
  anysearch: svgToDataUri(anysearchSvg),
  brave: svgToDataUri(braveSvg),
  deepseek: svgToDataUri(deepseekSvg),
  doubao: svgToDataUri(doubaoSvg),
  exa: svgToDataUri(exaSvg),
  gemini: svgToDataUri(geminiSvg),
  gemma: svgToDataUri(gemmaSvg),
  google: svgToDataUri(googleSvg),
  hunyuan: svgToDataUri(hunyuanSvg),
  internlm: svgToDataUri(internlmSvg),
  kimi: svgToDataUri(kimiSvg),
  lmstudio: svgToDataUri(lmstudioSvg),
  'llama-cpp': svgToDataUri(llamaCppSvg),
  meta: svgToDataUri(metaSvg),
  microsoft: svgToDataUri(microsoftSvg),
  minimax: svgToDataUri(minimaxSvg),
  mistral: svgToDataUri(mistralSvg),
  moonshot: svgToDataUri(moonshotSvg),
  nvidia: svgToDataUri(nvidiaSvg),
  ollama: svgToDataUri(ollamaSvg),
  openai: svgToDataUri(openaiSvg),
  opencode: svgToDataUri(opencodeSvg),
  openrouter: svgToDataUri(openrouterSvg),
  qwen: svgToDataUri(qwenSvg),
  tavily: svgToDataUri(tavilySvg),
  xai: svgToDataUri(xaiSvg),
  xiaomimimo: svgToDataUri(xiaomiMiMoSvg),
  yi: svgToDataUri(yiSvg),
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

/** Host-provided Lucide icon fallback. */
export function LucideIcon({ className, name }: { readonly className: string; readonly name: string }) {
  const platform = usePresentationPlatform();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) platform.renderIcon(ref.current, name);
  }, [name, platform]);
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
