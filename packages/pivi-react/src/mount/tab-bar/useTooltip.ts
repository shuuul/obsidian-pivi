import { useEffect, useRef } from 'react';

import { usePresentationPlatform } from '../../platform';
import { TOOLTIP_DELAY_MS } from './constants';

export function useTooltip(label: string) {
  const platform = usePresentationPlatform();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) platform.attachTooltip(ref.current, label, { delay: TOOLTIP_DELAY_MS });
  }, [label, platform]);
  return ref;
}
