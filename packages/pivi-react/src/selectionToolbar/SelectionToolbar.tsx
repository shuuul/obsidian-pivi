import { type ReactNode, useEffect, useRef } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import { usePresentationPlatform } from '../platform';

export interface SelectionToolbarItem {
  id: string;
  label: string;
  kind: 'pivi-action' | 'editor-command' | 'obsidian-command' | 'pivi-command';
  icon?: string;
}

export interface SelectionToolbarProps {
  items: readonly SelectionToolbarItem[];
  onItem: (id: string) => void;
}

function IconButton({
  className,
  label,
  onClick,
  children,
}: {
  readonly className: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  const platform = usePresentationPlatform();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ref.current) platform.attachTooltip(ref.current, label);
  }, [label, platform]);
  return (
    <button
      aria-label={label}
      className={className}
      onClick={onClick}
      ref={ref}
      type="button"
    >
      {children}
    </button>
  );
}

function itemIconName(item: SelectionToolbarItem): string {
  if (item.icon) return item.icon;
  return item.kind === 'pivi-command' ? 'message-square' : 'terminal';
}

export function SelectionToolbar({
  items,
  onItem,
}: SelectionToolbarProps) {
  useT();

  return (
    <div className="pivi-selection-toolbar" data-pivi-react-surface="selection-toolbar">
      <div className="pivi-selection-toolbar-group">
        {items.map(item => (
          <IconButton
            className="pivi-selection-toolbar-btn pivi-selection-toolbar-btn--icon"
            key={item.id}
            label={item.label}
            onClick={() => onItem(item.id)}
          >
            <PlatformIcon name={itemIconName(item)} />
          </IconButton>
        ))}
      </div>
    </div>
  );
}
