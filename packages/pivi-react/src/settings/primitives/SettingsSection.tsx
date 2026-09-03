import type { ReactNode } from 'react';

export function SettingsSectionHeading({
  children,
  id,
  level = 2,
}: {
  readonly children: ReactNode;
  readonly id?: string;
  readonly level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const levelClass = level === 3 ? ' pivi-settings-section-heading--sub' : '';
  return (
    <Heading id={id} className={`pivi-settings-section-heading${levelClass}`}>
      {children}
    </Heading>
  );
}

export function SettingsSection({
  title,
  headingId,
  headingLevel = 2,
  actions,
  children,
}: {
  readonly title: ReactNode;
  readonly headingId?: string;
  readonly headingLevel?: 2 | 3;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <section
      className="pivi-settings-section"
      {...(headingId ? { 'aria-labelledby': headingId } : {})}
    >
      <div className="pivi-settings-section__header">
        <SettingsSectionHeading id={headingId} level={headingLevel}>
          {title}
        </SettingsSectionHeading>
        {actions ? <div className="pivi-settings-section__actions">{actions}</div> : null}
      </div>
      <div className="pivi-settings-section__body">{children}</div>
    </section>
  );
}
