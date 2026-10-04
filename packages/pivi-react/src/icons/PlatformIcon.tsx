import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

/** Mount an Obsidian icon into a span for React-owned chrome. */
export function PlatformIcon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span aria-hidden="true" className="pivi-platform-icon" ref={ref} />;
}
