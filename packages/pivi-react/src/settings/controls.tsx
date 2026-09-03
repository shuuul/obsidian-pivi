import type { ReactNode } from 'react';

import { SettingsSection } from './primitives';

export {
  SettingRow,
  type SettingRowProps,
  SettingsFeedback as SettingsActionFeedback,
  SettingsFeedback,
  SettingsInlineActions,
  SettingsInlineActions as SettingsItemActions,
  SettingsPage,
  SettingsPageDescription,
  SettingsSection,
  SettingsSectionHeading,
} from './primitives';
export {
  BadgeListInput,
  Select,
  SettingsRemoveButton,
  Toggle,
} from './primitives/controls';

/** Thin adapter over SettingsSection. Deleted in WS-06. */
export function SettingsListHeader({
  title,
  actions,
}: {
  readonly title?: string;
  readonly actions?: ReactNode;
}) {
  return <SettingsSection title={title ?? ''} actions={actions}>{null}</SettingsSection>;
}
