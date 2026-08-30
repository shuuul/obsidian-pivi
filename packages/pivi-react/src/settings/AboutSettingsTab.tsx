import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsAboutPort } from '../ports';
import { SettingRow, SettingsSection } from './controls';

export function AboutSettingsTab({ about }: { readonly about: SettingsAboutPort }) {
  const t = useT();
  const snapshot = about.getSnapshot();

  return (
    <SettingsSection title={t('settings.about.heading')}>
      <p className="pivi-setting-description">{t('settings.about.intro')}</p>
      <SettingRow
        name={t('settings.about.version')}
        description={t('settings.about.released', { date: snapshot.releasedAt })}
      >
        <span className="pivi-about-version">{snapshot.version}</span>
      </SettingRow>
      <SettingRow
        name={t('settings.about.github')}
        description={t('settings.about.githubDesc')}
      >
        <a
          className="pivi-about-github pivi-settings-external-link"
          href={snapshot.githubUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <PlatformIcon name="github" />
          <span>{t('settings.about.github')}</span>
        </a>
      </SettingRow>
      <SettingRow
        name={t('settings.about.issues')}
        description={t('settings.about.issuesDesc')}
      >
        <a
          className="pivi-settings-external-link"
          href={snapshot.issuesUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('settings.about.reportIssue')}
        </a>
      </SettingRow>
    </SettingsSection>
  );
}
