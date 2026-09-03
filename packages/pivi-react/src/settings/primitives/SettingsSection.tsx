import { createContext, type ReactNode, useContext } from 'react';

export const SettingsNestingContext = createContext(0);

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
  headingLevel,
  actions,
  children,
}: {
  readonly title?: ReactNode;
  readonly headingId?: string;
  readonly headingLevel?: 2 | 3;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  const depth = useContext(SettingsNestingContext);
  const nested = depth > 0;
  const level = headingLevel ?? (nested ? 3 : 2);
  const hasHeading = title != null && title !== '';
  return (
    <section
      className={`pivi-settings-section${nested ? ' pivi-settings-section--nested' : ''}`}
      {...(headingId ? { 'aria-labelledby': headingId } : {})}
    >
      {hasHeading ? (
        <div className="pivi-settings-section__header">
          <SettingsSectionHeading id={headingId} level={level}>
            {title}
          </SettingsSectionHeading>
          {actions ? <div className="pivi-settings-section__actions">{actions}</div> : null}
        </div>
      ) : null}
      <SettingsNestingContext.Provider value={depth + 1}>
        <div className="pivi-settings-section__body">{children}</div>
      </SettingsNestingContext.Provider>
    </section>
  );
}
