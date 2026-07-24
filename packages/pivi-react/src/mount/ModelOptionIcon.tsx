import type { ChatIconSvg, ChatSvgChild } from '@pivi/pivi-agent-core/foundation';
import type { CSSProperties } from 'react';

import { LucideIcon, PROVIDER_LOGOS, providerFallbackIcon } from '../icons/ProviderLogo';
import type { ComposerOptionSnapshot, DeepReadonly } from '../store';
import { PiviBrandIcon } from './PiviBrandIcon';

function renderSvgChild(child: DeepReadonly<ChatSvgChild>, key: number) {
  if (child.tag === 'g') {
    return <g key={key} {...child.attributes}>{child.children.map((nested, index) => renderSvgChild(nested, index))}</g>;
  }
  return <path key={key} {...child.attributes} />;
}

function InlineChatIcon({ className, icon }: { className: string; icon: DeepReadonly<ChatIconSvg> }) {
  if (icon.kind === 'pivi-brand') {
    return <PiviBrandIcon className={className} height={12} width={12} />;
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
