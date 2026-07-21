import { type ReactNode, useEffect, useRef } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import { ChatLogo } from '../mount/ChatLogo';
import { usePresentationPlatform } from '../platform';

export interface SelectionToolbarShortcut {
  id: string;
  label: string;
  kind: 'obsidian-command' | 'pivi-command';
  icon?: string;
}

export interface SelectionToolbarProps {
  shortcuts: readonly SelectionToolbarShortcut[];
  onAskAi: () => void;
  onAddToChat: () => void;
  onShortcut: (id: string) => void;
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

function shortcutIconName(shortcut: SelectionToolbarShortcut): string {
  if (shortcut.icon) return shortcut.icon;
  return shortcut.kind === 'pivi-command' ? 'message-square' : 'terminal';
}

export function SelectionToolbar({
  shortcuts,
  onAskAi,
  onAddToChat,
  onShortcut,
}: SelectionToolbarProps) {
  const t = useT();

  return (
    <div className="pivi-selection-toolbar" data-pivi-react-surface="selection-toolbar">
      <div className="pivi-selection-toolbar-group">
        <IconButton
          className="pivi-selection-toolbar-btn pivi-selection-toolbar-btn--icon pivi-selection-toolbar-btn--primary"
          label={t('editor.selectionToolbar.askAi')}
          onClick={onAskAi}
        >
          <span className="pivi-selection-toolbar-icon" aria-hidden="true">
            <ChatLogo icon={{ kind: 'pivi-brand', viewBox: '0 0 100 100' }} />
          </span>
        </IconButton>
        <IconButton
          className="pivi-selection-toolbar-btn pivi-selection-toolbar-btn--icon"
          label={t('editor.selectionToolbar.addToChat')}
          onClick={onAddToChat}
        >
          <PlatformIcon name="message-square-plus" />
        </IconButton>
      </div>
      {shortcuts.length > 0 ? (
        <>
          <div aria-hidden="true" className="pivi-selection-toolbar-divider" />
          <div className="pivi-selection-toolbar-group">
            {shortcuts.map(shortcut => (
              <IconButton
                className="pivi-selection-toolbar-btn pivi-selection-toolbar-btn--icon"
                key={shortcut.id}
                label={shortcut.label}
                onClick={() => onShortcut(shortcut.id)}
              >
                <PlatformIcon name={shortcutIconName(shortcut)} />
              </IconButton>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
