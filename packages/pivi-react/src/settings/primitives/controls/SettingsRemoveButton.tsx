import type { MouseEvent } from 'react';

import { PlatformIcon } from '../../../icons';

export function SettingsRemoveButton({
  ariaLabel,
  disabled = false,
  className = '',
  onClick,
}: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`pivi-settings-action-btn pivi-settings-delete-btn${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <PlatformIcon name="trash-2" />
    </button>
  );
}
