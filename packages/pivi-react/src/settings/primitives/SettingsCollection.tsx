import { Children, type ReactNode, type Ref } from 'react';

export function SettingsCollection({
  children,
  emptyState,
  addLabel,
  onAdd,
  addAriaLabel,
  addDisabled = false,
  addTrigger,
  listRef,
  announcement,
  className,
}: {
  readonly children?: ReactNode;
  readonly emptyState?: string;
  readonly addLabel?: string;
  readonly onAdd?: () => void;
  readonly addAriaLabel?: string;
  readonly addDisabled?: boolean;
  readonly addTrigger?: ReactNode;
  readonly listRef?: Ref<HTMLDivElement | null>;
  readonly announcement?: string;
  readonly className?: string;
}) {
  const isEmpty = Children.toArray(children).length === 0;
  return (
    <div className={`pivi-settings-collection${className ? ` ${className}` : ''}`}>
      {isEmpty && emptyState ? (
        <p className="pivi-settings-collection__empty">{emptyState}</p>
      ) : (
        <div className="pivi-settings-collection__list" ref={listRef} role="list">
          {children}
        </div>
      )}
      {addTrigger ?? (addLabel && onAdd ? (
        <button
          type="button"
          className="pivi-settings-collection__add pivi-settings-text-btn"
          aria-label={addAriaLabel}
          disabled={addDisabled}
          onClick={onAdd}
        >
          {addLabel}
        </button>
      ) : null)}
      <div className="pivi-visually-hidden" aria-live="polite">{announcement ?? ''}</div>
    </div>
  );
}
