import { createContext, type ReactNode, useContext } from 'react';

export const SettingsNestingContext = createContext(0);

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
  const Heading = level === 2 ? 'h2' : 'h3';
  const levelClass = level === 3 ? ' pivi-settings-section-heading--sub' : '';
  return (
    <section
      className={`pivi-settings-section${nested ? ' pivi-settings-section--nested' : ''}`}
      {...(headingId ? { 'aria-labelledby': headingId } : {})}
    >
      {hasHeading ? (
        <div className="pivi-settings-section__header">
          <Heading id={headingId} className={`pivi-settings-section-heading${levelClass}`}>
            {title}
          </Heading>
          {actions ? <div className="pivi-settings-section__actions">{actions}</div> : null}
        </div>
      ) : null}
      <SettingsNestingContext.Provider value={depth + 1}>
        <div className="pivi-settings-section__body">{children}</div>
      </SettingsNestingContext.Provider>
    </section>
  );
}
