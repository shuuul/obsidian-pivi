import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsCatalogPort, SettingsComplexPorts, SettingsModelsPort } from '../ports';
import { AddProviderPicker } from './models/AddProviderPicker';
import { ProviderCard } from './models/ProviderCard';

export interface ModelsSettingsTabProps {
  readonly models: SettingsComplexPorts['models'];
  readonly catalog: SettingsCatalogPort;
}

/** Provider-card model settings: credentials, custom endpoints, and visible models. */
export function ModelsSettingsTab({ models, catalog }: ModelsSettingsTabProps) {
  const t = useT();
  const terminology = useHostTerminology();
  const [bootstrapInfo] = useState(() => models.bootstrap());
  const [settings, setSettings] = useState(() => models.getSettings());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => setSettings(models.getSettings());
  const save = async (patch: Parameters<SettingsModelsPort['saveSettings']>[0]): Promise<void> => {
    await models.saveSettings(patch);
    reload();
  };

  const toggleExpanded = (providerId: string, open?: boolean): void => {
    setExpanded(current => {
      const next = new Set(current);
      const shouldOpen = open ?? !next.has(providerId);
      if (shouldOpen) next.add(providerId);
      else next.delete(providerId);
      return next;
    });
  };

  const onProviderAdded = (providerId: string): void => {
    toggleExpanded(providerId, true);
    reload();
  };

  return (
    <>
      {bootstrapInfo.secureStorageAvailable ? null : (
        <div className="pivi-sp-settings-desc">
          <p>{t('settings.modelsTab.secureStorageRequired', {
            hostName: terminology.hostName,
            secureStorageName: terminology.secureStorageName,
            version: bootstrapInfo.minimumHostVersion,
          })}</p>
        </div>
      )}
      <div className="pivi-sp-settings-desc">
        <p>{t('settings.modelsTab.intro', {
          secureStorageName: terminology.secureStorageName,
        })}</p>
      </div>
      <div className="pivi-providers-list">
        {settings.addedProviders.map(providerId => (
          <ProviderCard
            key={providerId}
            models={models}
            catalog={catalog}
            providerId={providerId}
            settings={settings}
            expanded={expanded.has(providerId)}
            onToggleExpanded={toggleExpanded}
            save={save}
            onChanged={reload}
            onError={setError}
          />
        ))}
      </div>
      <AddProviderPicker models={models} onProviderAdded={onProviderAdded} onError={setError} />
      {error ? (
        <div className="pivi-sp-settings-desc">
          <p>{error}</p>
        </div>
      ) : null}
    </>
  );
}
