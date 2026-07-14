import type { WebProviderId, WebSearchToolsSettings } from '@pivi/pivi-agent-core/foundation/settings';
import { useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsPorts, SettingsWebProviderSnapshot } from '../ports';
import { useProviderReorder } from './providers/useProviderReorder';
import { WebProviderCard } from './web/WebProviderCard';

export function WebSearchTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const { secureStorageName } = useHostTerminology();
  const webSearch = ports.complex.webSearch;
  const providers = webSearch.listProviders();
  const [settings, setSettings] = useState<WebSearchToolsSettings>(() => webSearch.getSettings());
  const [expanded, setExpanded] = useState<ReadonlySet<WebProviderId>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (
    next: WebSearchToolsSettings,
    rollback: WebSearchToolsSettings,
  ): Promise<boolean> => {
    setSettings(next);
    setPending(true);
    setError(null);
    try {
      await webSearch.saveSettings(next);
    } catch {
      setSettings(rollback);
      setError(t('common.error'));
      setPending(false);
      return false;
    }
    try {
      await ports.complex.runtime.refreshPrompt();
    } catch {
      setError(t('common.error'));
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

  const reorder = useProviderReorder<WebProviderId>({
    order: settings.providerOrder,
    disabled: pending,
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
      <div className="pivi-sp-settings-desc">
        <p className="pivi-setting-description">{t('settings.webSearch.intro')}</p>
      </div>
      {error ? <div className="pivi-setting-description" role="alert">{error}</div> : null}
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
            onError={() => { setError(t('common.error')); }}
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
