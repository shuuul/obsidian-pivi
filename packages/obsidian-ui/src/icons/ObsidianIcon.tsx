import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

/** Mount an Obsidian/Lucide icon into a span for React-owned chrome. */
export function ObsidianIcon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span aria-hidden="true" ref={ref} />;
}
