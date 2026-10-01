/** Environment settings: structured device-local variables and bulk text import. */

import { useState } from 'react';

import { useT } from '../i18n';
import type {
  SettingsEnvironmentEntryView,
  SettingsEnvironmentPort,
  SettingsFeedbackPort,
} from '../ports';
import {
  SettingRow,
  SettingsCollection,
  SettingsPage,
  SettingsSection,
} from './primitives';

export function environmentEntriesToSafeText(entries: readonly SettingsEnvironmentEntryView[]): string {
  return entries.map((entry) => {
    if (entry.sourceKind === 'secret') {
      return `${entry.key}=`;
    }
    if (entry.sourceKind === 'systemEnvironment') {
      return `${entry.key}=$${entry.systemName ?? entry.key}`;
    }
    return `${entry.key}=${entry.plainValue ?? ''}`;
  }).join('\n');
}

export function EnvironmentSection({ environment, feedback }: {
  readonly environment: SettingsEnvironmentPort;
  readonly feedback: SettingsFeedbackPort;
}) {
  const t = useT();
  const [entries, setEntries] = useState(() => environment.listEntries('shared'));
  const [value, setValue] = useState(() => environmentEntriesToSafeText(environment.listEntries('shared')));
  const [savedValue, setSavedValue] = useState(value);
  const [applying, setApplying] = useState(false);
  const reviewKeys = environment.getReviewKeys('shared', value);
  const isDirty = value !== savedValue;

  const refreshEntries = () => {
    const next = environment.listEntries('shared');
    const nextValue = environmentEntriesToSafeText(next);
    setEntries(next);
    setValue(nextValue);
    setSavedValue(nextValue);
  };

  const apply = () => {
    setApplying(true);
    void environment.importEnvironmentText('shared', value)
      .then(() => {
        refreshEntries();
      })
      .catch((cause: unknown) => {
        feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      })
      .finally(() => {
        setApplying(false);
      });
  };

  const storageLabel = (location: SettingsEnvironmentEntryView['storageLocation']) => {
    if (location === 'secureStorage') {
      return t('settings.sharedEnvironment.storageSecure');
    }
    if (location === 'systemEnvironment') {
      return t('settings.sharedEnvironment.storageSystem');
    }
    return t('settings.sharedEnvironment.storageDeviceLocal');
  };

  const entryValue = (entry: SettingsEnvironmentEntryView): string => {
    if (entry.sourceKind === 'secret') {
      return entry.hasStoredSecret
        ? t('settings.sharedEnvironment.secretStored')
        : t('settings.sharedEnvironment.secretMissing');
    }
    if (entry.sourceKind === 'systemEnvironment') {
      return `$${entry.systemName ?? entry.key}`;
    }
    return entry.plainValue ?? '';
  };

  return (
    <SettingsPage description={t('settings.pages.environment.description')}>
      <SettingsSection>
        {reviewKeys.length > 0 ? (
          <div className="pivi-env-review-warning pivi-setting-validation pivi-setting-validation-warning">
            {t('settings.sharedEnvironment.reviewOwnership', { keys: reviewKeys.join(', ') })}
          </div>
        ) : null}
        {entries.length > 0 ? (
          <SettingsCollection>
            {entries.map((entry) => (
              <SettingRow
                key={`${entry.scope}:${entry.key}`}
                name={entry.key}
                description={`${storageLabel(entry.storageLocation)} · ${entryValue(entry)}`}
              />
            ))}
          </SettingsCollection>
        ) : null}
        <SettingRow
          stacked
          name={t('settings.sharedEnvironment.name')}
          description={t('settings.sharedEnvironment.desc')}
        >
          <textarea
            className="pivi-settings-control pivi-settings-control--fill pivi-settings-env-textarea"
            rows={6}
            placeholder={t('settings.sharedEnvironment.placeholder')}
            value={value}
            // Disable the draft while apply is pending so a completion refresh cannot overwrite a newer edit.
            disabled={applying}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
          <div className="pivi-settings-action-group">
            <button type="button" className="pivi-button--primary" disabled={!isDirty || applying} onClick={apply}>
              {t('settings.sharedEnvironment.apply')}
            </button>
          </div>
        </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}
