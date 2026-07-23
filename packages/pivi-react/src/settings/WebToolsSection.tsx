import type { WebProviderId, WebSearchToolsSettings } from '@pivi/pivi-agent-core/foundation/settings';
import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts, SettingsWebProviderSnapshot } from '../ports';
import { useSortableReorder } from '../reorder/useSortableReorder';
import { SettingsPageDescription } from './controls';
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
    itemSelector: '[data-provider-sort-id]',
    itemDataKey: 'providerSortId',
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
    <>
      <SettingsPageDescription>
        <p className="pivi-setting-description">{t('settings.webSearch.intro')}</p>
      </SettingsPageDescription>
      <div className="pivi-setting-item">
        <div className="pivi-setting-item-info">
          <div className="pivi-setting-item-name">{t('settings.webSearch.fetchMode.name')}</div>
          <div className="pivi-setting-item-description">{t('settings.webSearch.fetchMode.desc')}</div>
        </div>
        <div className="pivi-setting-item-control">
          <select
            className="pivi-settings-control"
            disabled={pending}
            value={settings.fetchMode}
            aria-label={t('settings.webSearch.fetchMode.name')}
            onChange={(event) => {
              const fetchMode = event.target.value === 'allow-extractors'
                ? 'allow-extractors'
                : 'direct-only';
              void persist({ ...settings, fetchMode }, settings);
            }}
          >
            <option value="direct-only">{t('settings.webSearch.fetchMode.directOnly')}</option>
            <option value="allow-extractors">{t('settings.webSearch.fetchMode.allowExtractors')}</option>
          </select>
        </div>
      </div>
      {settings.fetchMode === 'allow-extractors' ? (
        <p className="pivi-setting-description pivi-web-fetch-disclosure">
          {t('settings.webSearch.fetchMode.disclosure')}
        </p>
      ) : null}
      <div className="pivi-providers-list" ref={reorder.listRef}>
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
      </div>
      <div className="pivi-web-fallback-note">
        <p>{t('settings.webSearch.fixedFallbacks')}</p>
      </div>
      <div className="pivi-visually-hidden" aria-live="polite">{reorder.announcement}</div>
    </>
  );
}
