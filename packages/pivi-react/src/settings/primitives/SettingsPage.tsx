import type { ReactNode } from 'react';

export function SettingsPage({
  description,
  className,
  children,
}: {
  readonly description?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className={`pivi-settings-page${className ? ` ${className}` : ''}`}>
      {description ? <div className="pivi-settings-page__description">{description}</div> : null}
      {children}
    </div>
  );
}
