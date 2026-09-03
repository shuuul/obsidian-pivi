import type { ReactNode } from 'react';

export function SettingsPageDescription({ children }: { readonly children: ReactNode }) {
  return <div className="pivi-settings-page__description">{children}</div>;
}

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
      {description ? <SettingsPageDescription>{description}</SettingsPageDescription> : null}
      {children}
    </div>
  );
}
