import type { ChatIconSvg, ChatSvgChild } from '@pivi/pivi-agent-core/foundation';
import { type CSSProperties, useId } from 'react';

import { LucideIcon, PROVIDER_LOGOS, providerFallbackIcon } from '../icons/ProviderLogo';
import type { ComposerOptionSnapshot, DeepReadonly } from '../store';

function renderSvgChild(child: DeepReadonly<ChatSvgChild>, key: number) {
  if (child.tag === 'g') {
    return <g key={key} {...child.attributes}>{child.children.map((nested, index) => renderSvgChild(nested, index))}</g>;
  }
  return <path key={key} {...child.attributes} />;
}

function InlineChatIcon({ className, icon }: { className: string; icon: DeepReadonly<ChatIconSvg> }) {
  const generatedId = useId().replace(/:/g, '');
  if (icon.kind === 'pivi-brand') {
    const maskId = `pivi-model-brand-${generatedId}`;
    return <svg aria-hidden="true" className={className} fill="none" height="12" viewBox="0 0 100 100" width="12"><defs><mask id={maskId}><rect fill="black" height="100" width="100" /><rect fill="white" height="72" rx="9" width="18" x="23" y="14" /><g transform="rotate(18 56 35)"><ellipse cx="56" cy="35" fill="white" rx="31" ry="25" /></g><g transform="rotate(-20 58 36)"><ellipse cx="58" cy="36" fill="black" rx="14" ry="11" /></g></mask></defs><rect fill="currentColor" height="100" mask={`url(#${maskId})`} width="100" /></svg>;
  }
  return <svg aria-hidden="true" className={className} fill="none" height="12" viewBox={icon.viewBox} width="12">{icon.kind === 'composite' ? icon.children.map((child, index) => renderSvgChild(child, index)) : <path d={icon.path} fill="currentColor" />}</svg>;
}

export function ModelOptionIcon({ option }: { option: DeepReadonly<ComposerOptionSnapshot> }) {
  const className = 'pivi-model-provider-icon';
  if (option.providerLogoSlug) {
    const dataUri = PROVIDER_LOGOS[option.providerLogoSlug];
    if (dataUri) {
      const style = {
        '--pivi-provider-logo-size': '12px',
        WebkitMaskImage: `url("${dataUri}")`,
        maskImage: `url("${dataUri}")`,
      } as CSSProperties;
      return <span aria-hidden="true" className={`pivi-provider-logo-mask ${className}`} style={style} />;
    }
    return <LucideIcon className={className} name={providerFallbackIcon(option.providerLogoSlug)} />;
  }
  if (option.chatIcon) return <InlineChatIcon className={className} icon={option.chatIcon} />;
  return <LucideIcon className={className} name={option.fallbackIcon ?? 'cpu'} />;
}
