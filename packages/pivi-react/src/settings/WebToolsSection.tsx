import type { WebProviderId, WebSearchToolsSettings } from '@pivi/agent/settings/types';
import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts, SettingsWebProviderSnapshot } from '../ports';
import { useSortableReorder } from '../reorder/useSortableReorder';
import { SettingsCollection, SettingsPage, SettingsSection } from './primitives';
import { WebProviderCard } from './web/WebProviderCard';

export function WebToolsSection({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const webSearch = ports.complex.webSearch;
  const providers = webSearch.listProviders();
  const [settings, setSettings] = useState<WebSearchToolsSettings>(() => webSearch.getSettings());
  const [expanded, setExpanded] = useState<ReadonlySet<WebProviderId>>(() => new Set());
  const [pending, setPending] = useState(false);

  const persist = async (
    next: WebSearchToolsSettings,
    rollback: WebSearchToolsSettings,
  ): Promise<boolean> => {
    setSettings(next);
    setPending(true);
    try {
      await webSearch.saveSettings(next);
    } catch {
      setSettings(rollback);
      ports.feedback.notify(t('common.error'));
      setPending(false);
      return false;
    }
    try {
      await ports.complex.runtime.refreshPrompt();
    } catch {
      ports.feedback.notify(t('common.error'));
    } finally {
      setPending(false);
    }
    return true;
  };

  const toggleExpanded = (id: WebProviderId): void => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDisabled = (id: WebProviderId): void => {
    const disabled = new Set(settings.disabledProviders);
    if (disabled.has(id)) disabled.delete(id);
    else disabled.add(id);
    void persist(
      { ...settings, disabledProviders: [...disabled] },
      settings,
    );
  };

  const reorder = useSortableReorder<WebProviderId, HTMLElement>({
    order: settings.providerOrder,
    disabled: pending,
    itemSelector: '[data-settings-sort-id]',
    itemDataKey: 'settingsSortId',
    setOrder: providerOrder => { setSettings(current => ({ ...current, providerOrder })); },
    commitOrder: async (providerOrder, originalOrder) => {
      return persist(
        { ...settings, providerOrder },
        { ...settings, providerOrder: [...originalOrder] },
      );
    },
    positionAnnouncement: (id, position, total) => t('settings.webSearch.reorder.position', {
      provider: providers.find(candidate => candidate.id === id)?.id ?? id,
      position,
      total,
    }),
    savedAnnouncement: t('settings.webSearch.reorder.saved'),
    cancelledAnnouncement: t('settings.webSearch.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });

  const orderedProviders = settings.providerOrder
    .map(id => providers.find(provider => provider.id === id))
    .filter((provider): provider is SettingsWebProviderSnapshot => Boolean(provider));

  return (
    <SettingsPage
      description={(
        <>
          <p>{t('settings.webSearch.intro')}</p>
          <p>{t('settings.webSearch.fixedFallbacks')}</p>
        </>
      )}
    >
      <SettingsSection>
        <SettingsCollection listRef={reorder.listRef} announcement={reorder.announcement}>
          {orderedProviders.map((provider, index) => (
            <WebProviderCard
              key={provider.id}
              provider={provider}
              position={index + 1}
              disabled={settings.disabledProviders.includes(provider.id)}
              expanded={expanded.has(provider.id)}
              pending={pending}
              dragging={reorder.draggingId === provider.id}
              dragOffset={reorder.draggingId === provider.id ? reorder.dragOffset : 0}
              secureStorageName={secureStorageName}
              ports={ports}
              onToggleExpanded={() => { toggleExpanded(provider.id); }}
              onToggleDisabled={() => { toggleDisabled(provider.id); }}
              reorderHandleProps={reorder.getHandleProps(provider.id)}
              suppressReorderClick={() => reorder.consumeClickAfterDrag(provider.id)}
              onError={() => { ports.feedback.notify(t('common.error')); }}
            />
          ))}
        </SettingsCollection>
      </SettingsSection>
    </SettingsPage>
  );
}
