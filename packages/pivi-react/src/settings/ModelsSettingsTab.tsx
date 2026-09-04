import { useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { useHostTerminology } from '../platform';
import type { SettingsCatalogPort, SettingsComplexPorts, SettingsFeedbackPort, SettingsModelsPort } from '../ports';
import { useSortableReorder } from '../reorder/useSortableReorder';
import { AddProviderPicker } from './models/AddProviderPicker';
import { ProviderCard } from './models/ProviderCard';
import { SettingsCollection, SettingsPage, SettingsSection } from './primitives';

function buildInteractiveOAuthMembershipKey(
  addedProviders: readonly string[],
  disabledProviders: readonly string[],
  interactiveOAuthProviderIds: readonly string[],
): string {
  const interactive = new Set(interactiveOAuthProviderIds);
  const disabled = new Set(disabledProviders);
  return addedProviders
    .filter(providerId => interactive.has(providerId) && !disabled.has(providerId))
    .sort()
    .join('\0');
}

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
  const [draftProviderIds, setDraftProviderIds] = useState<ReadonlySet<string>>(() => new Set());
  const [reorderPending, setReorderPending] = useState(false);
  const [credentialCheckPending, setCredentialCheckPending] = useState(true);
  const initialCredentialCheck = useRef(true);
  const unavailableDisableAttempts = useRef(new Set<string>());

  const reload = (): void => setSettings(models.getSettings());
  const interactiveOAuthMembershipKey = buildInteractiveOAuthMembershipKey(
    settings.addedProviders,
    settings.disabledProviders,
    models.interactiveOAuthProviderIds,
  );

  useEffect(() => {
    let cancelled = false;
    const showChecking = initialCredentialCheck.current;
    if (showChecking) setCredentialCheckPending(true);
    void models.ensureProviderCredentials()
      .then(() => {
        if (!cancelled) {
          setSettings(models.getSettings());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(models.getSettings());
        }
      })
      .finally(() => {
        if (!cancelled) {
          initialCredentialCheck.current = false;
          if (showChecking) setCredentialCheckPending(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [models, interactiveOAuthMembershipKey]);

  useEffect(() => {
    if (credentialCheckPending) return;
    const disabled = new Set(settings.disabledProviders);
    const newlyUnavailable = settings.addedProviders.filter((providerId) => {
      if (models.getReadiness(providerId) !== 'unavailable') {
        unavailableDisableAttempts.current.delete(providerId);
        return false;
      }
      return !disabled.has(providerId) && !unavailableDisableAttempts.current.has(providerId);
    });
    if (newlyUnavailable.length === 0) return;
    for (const providerId of newlyUnavailable) {
      disabled.add(providerId);
      unavailableDisableAttempts.current.add(providerId);
    }
    const disabledProviders = [...disabled];
    setSettings(current => ({ ...current, disabledProviders }));
    void models.saveSettings({ disabledProviders }).catch((cause: unknown) => {
      setSettings(models.getSettings());
      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    });
  }, [credentialCheckPending, feedback, models, settings.addedProviders, settings.disabledProviders, t]);

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
    setDraftProviderIds(current => new Set(current).add(providerId));
    toggleExpanded(providerId, true);
    reload();
  };

  const confirmDraft = (providerId: string): void => {
    setDraftProviderIds(current => {
      const next = new Set(current);
      next.delete(providerId);
      return next;
    });
  };

  const cancelDraft = (providerId: string): void => {
    void models.removeProvider(providerId, false)
      .then(() => {
        confirmDraft(providerId);
        setExpanded(current => {
          const next = new Set(current);
          next.delete(providerId);
          return next;
        });
        setSettings(current => ({
          ...current,
          addedProviders: current.addedProviders.filter(id => id !== providerId),
          disabledProviders: current.disabledProviders.filter(id => id !== providerId),
        }));
      })
      .catch((cause: unknown) => {
        feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
      });
  };

  const committedProviders = settings.addedProviders.filter(id => !draftProviderIds.has(id));
  const reorder = useSortableReorder<string, HTMLElement>({
    order: committedProviders,
    disabled: reorderPending || committedProviders.length < 2,
    itemSelector: '[data-settings-sort-id]',
    itemDataKey: 'settingsSortId',
    setOrder: addedProviders => {
      setSettings(current => ({
        ...current,
        addedProviders: [
          ...addedProviders,
          ...current.addedProviders.filter(id => draftProviderIds.has(id)),
        ],
      }));
    },
    commitOrder: async (addedProviders, originalOrder) => {
      const drafts = settings.addedProviders.filter(id => draftProviderIds.has(id));
      const next = [...addedProviders, ...drafts];
      setReorderPending(true);
      try {
        await models.saveSettings({ addedProviders: next });
        reload();
        return true;
      } catch (cause) {
        setSettings(current => ({ ...current, addedProviders: [...originalOrder, ...drafts] }));
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

  const description = (
    <>
      {bootstrapInfo.secureStorageAvailable ? null : (
        <p>{t('settings.modelsTab.secureStorageRequired', {
          hostName: terminology.hostName,
          secureStorageName: terminology.secureStorageName,
          version: bootstrapInfo.minimumHostVersion,
        })}</p>
      )}
      <p>{t('settings.modelsTab.intro', {
        secureStorageName: terminology.secureStorageName,
      })}</p>
    </>
  );

  return (
    <SettingsPage description={description}>
      <SettingsSection>
        <SettingsCollection
          listRef={reorder.listRef}
          announcement={reorder.announcement}
          addTrigger={(
            <AddProviderPicker
              models={models}
              onProviderAdded={onProviderAdded}
              onError={(message) => feedback.notify(message)}
            />
          )}
        >
          {settings.addedProviders.map((providerId, index) => {
            const isDraft = draftProviderIds.has(providerId);
            const committedIndex = committedProviders.indexOf(providerId);
            return (
            <ProviderCard
              key={providerId}
              models={models}
              feedback={feedback}
              catalog={catalog}
              providerId={providerId}
              position={committedIndex >= 0 ? committedIndex + 1 : index + 1}
              settings={settings}
              expanded={expanded.has(providerId)}
              pending={reorderPending}
              dragging={!isDraft && reorder.draggingId === providerId}
              dragOffset={!isDraft && reorder.draggingId === providerId ? reorder.dragOffset : 0}
              dropIndicatorEdge={!isDraft && reorder.dropIndicator?.id === providerId
                ? reorder.dropIndicator.edge
                : undefined}
              reorderHandleProps={reorder.getHandleProps(providerId)}
              suppressReorderClick={() => reorder.consumeClickAfterDrag(providerId)}
              onToggleExpanded={toggleExpanded}
              save={save}
              onChanged={reload}
              onRemoved={() => {
                confirmDraft(providerId);
                setSettings(current => ({
                  ...current,
                  addedProviders: current.addedProviders.filter(id => id !== providerId),
                  disabledProviders: current.disabledProviders.filter(id => id !== providerId),
                }));
              }}
              isDraft={draftProviderIds.has(providerId)}
              onCancelDraft={() => { cancelDraft(providerId); }}
              onConfirmDraft={() => { confirmDraft(providerId); }}
              onError={(message) => feedback.notify(message)}
              credentialCheckPending={credentialCheckPending}
            />
            );
          })}
        </SettingsCollection>
      </SettingsSection>
    </SettingsPage>
  );
}
