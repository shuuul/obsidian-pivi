import { setTooltip } from 'obsidian';
import { useEffect, useRef } from 'react';

import { TOOLTIP_DELAY_MS } from './constants';

export function useTooltip(label: string) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setTooltip(ref.current, label, { delay: TOOLTIP_DELAY_MS });
  }, [label]);
  return ref;
}
