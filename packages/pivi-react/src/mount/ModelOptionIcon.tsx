import type { CSSProperties } from 'react';

import { LucideIcon, PROVIDER_LOGOS, providerFallbackIcon } from '../icons/ProviderLogo';
import type { ComposerOptionSnapshot, DeepReadonly } from '../store';

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
  return <LucideIcon className={className} name={option.fallbackIcon ?? 'cpu'} />;
}
