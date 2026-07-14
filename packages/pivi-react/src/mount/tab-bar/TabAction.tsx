import type { KeyboardEvent, MouseEvent } from 'react';

import { PlatformIcon } from '../../icons';
import { useTooltip } from './useTooltip';

export function TabAction({
  className,
  icon,
  label,
  onActivate,
}: {
  className: string;
  icon: string;
  label: string;
  onActivate: () => void;
}) {
  const ref = useTooltip(label);
  const activate = (event: MouseEvent | KeyboardEvent): void => {
    event.stopPropagation();
    if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
    if ('key' in event) event.preventDefault();
    onActivate();
  };
  return (
    <span
      aria-label={label}
      className={className}
      onClick={activate}
      onKeyDown={activate}
      ref={ref}
      role="button"
      tabIndex={0}
    >
      <PlatformIcon name={icon} />
    </span>
  );
}
