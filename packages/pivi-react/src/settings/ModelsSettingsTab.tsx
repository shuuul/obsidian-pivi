import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsCatalogPort, SettingsComplexPorts, SettingsFeedbackPort, SettingsModelsPort } from '../ports';
import { SettingsPageDescription } from './controls';
import { AddProviderPicker } from './models/AddProviderPicker';
import { ProviderCard } from './models/ProviderCard';
import { useProviderReorder } from './providers/useProviderReorder';

export interface ModelsSettingsTabProps {
  readonly models: SettingsComplexPorts['models'];
  readonly catalog: SettingsCatalogPort;
  readonly feedback: SettingsFeedbackPort;
}

/** Provider-card model settings: credentials, custom endpoints, and visible models. */
export function ModelsSettingsTab({ models, catalog, feedback }: ModelsSettingsTabProps) {
  const t = useT();
  const terminology = useHostTerminology();
  const [bootstrapInfo] = useState(() => models.bootstrap());
  const [settings, setSettings] = useState(() => models.getSettings());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [reorderPending, setReorderPending] = useState(false);

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

  const reorder = useProviderReorder<string>({
    order: settings.addedProviders,
    disabled: reorderPending,
    setOrder: addedProviders => { setSettings(current => ({ ...current, addedProviders })); },
    commitOrder: async (addedProviders, originalOrder) => {
      setReorderPending(true);
      try {
        await models.saveSettings({ addedProviders });
        reload();
        return true;
      } catch (cause) {
        setSettings(current => ({ ...current, addedProviders: [...originalOrder] }));
        feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
        return false;
      } finally {
        setReorderPending(false);
      }
    },
    positionAnnouncement: (id, position, total) => t('settings.webSearch.reorder.position', {
      provider: models.getProviderDisplayName(id),
      position,
      total,
    }),
    savedAnnouncement: t('settings.webSearch.reorder.saved'),
    cancelledAnnouncement: t('settings.webSearch.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });

  return (
    <>
      {bootstrapInfo.secureStorageAvailable ? null : (
        <SettingsPageDescription>
          <p className="pivi-setting-description">{t('settings.modelsTab.secureStorageRequired', {
            hostName: terminology.hostName,
            secureStorageName: terminology.secureStorageName,
            version: bootstrapInfo.minimumHostVersion,
          })}</p>
        </SettingsPageDescription>
      )}
      <SettingsPageDescription>
        <p className="pivi-setting-description">{t('settings.modelsTab.intro', {
          secureStorageName: terminology.secureStorageName,
        })}</p>
      </SettingsPageDescription>
      <div className="pivi-providers-list" ref={reorder.listRef}>
        {settings.addedProviders.map((providerId, index) => (
          <ProviderCard
            key={providerId}
            models={models}
            feedback={feedback}
            catalog={catalog}
            providerId={providerId}
            position={index + 1}
            settings={settings}
            expanded={expanded.has(providerId)}
            pending={reorderPending}
            dragging={reorder.draggingId === providerId}
            dragOffset={reorder.draggingId === providerId ? reorder.dragOffset : 0}
            reorderHandleProps={reorder.getHandleProps(providerId)}
            onToggleExpanded={toggleExpanded}
            save={save}
            onChanged={reload}
            onError={(message) => feedback.notify(message)}
          />
        ))}
      </div>
      <div className="pivi-visually-hidden" aria-live="polite">{reorder.announcement}</div>
      <AddProviderPicker models={models} onProviderAdded={onProviderAdded} onError={(message) => feedback.notify(message)} />
    </>
  );
}
