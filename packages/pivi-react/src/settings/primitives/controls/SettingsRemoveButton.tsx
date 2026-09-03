import { type MouseEvent, useState } from 'react';

import { useT } from '../../../i18n';
import { PlatformIcon } from '../../../icons';

export function SettingsRemoveButton({
  ariaLabel,
  disabled = false,
  className = '',
  confirming,
  onConfirmingChange,
  onClick,
}: {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly confirming?: boolean;
  readonly onConfirmingChange?: (confirming: boolean) => void;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const [internalConfirming, setInternalConfirming] = useState(false);
  const isConfirming = confirming ?? internalConfirming;
  const setConfirming = (next: boolean): void => {
    if (onConfirmingChange) onConfirmingChange(next);
    else setInternalConfirming(next);
  };

  return (
    <button
      type="button"
      className={`pivi-settings-action-btn pivi-settings-delete-btn${isConfirming ? ' pivi-settings-delete-btn--confirming' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-label={isConfirming ? t('common.confirmDelete') : ariaLabel}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isConfirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        onClick(event);
      }}
    >
      {isConfirming ? t('common.confirmDelete') : <PlatformIcon name="trash-2" />}
    </button>
  );
}
