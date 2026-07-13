import { useEffect, useRef } from 'react';

import { usePresentationPlatform } from '../platform';

/** Mount a host-provided icon into a span for React-owned chrome. */
export function PlatformIcon({ name }: { name: string }) {
  const platform = usePresentationPlatform();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) platform.renderIcon(ref.current, name);
  }, [name, platform]);
  return <span aria-hidden="true" className="pivi-platform-icon" ref={ref} />;
}
