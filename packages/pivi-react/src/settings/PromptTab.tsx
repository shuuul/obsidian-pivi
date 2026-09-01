import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { TranslationKey } from '../i18n';
import { useT } from '../i18n';
import type {
  SettingsPorts,
  SettingsPromptModuleView,
  SettingsPromptUsageSection,
  SettingsPromptUsageSectionId,
  SettingsPromptUsageSnapshot,
} from '../ports';
import {
  type SortableReorderHandleProps,
  useSortableReorder,
} from '../reorder/useSortableReorder';
import { ModalLayer } from '../shared/ModalLayer';
import { formatCompactTokenCount } from '../usage/usageInfo';
import {
  SettingsItemActions,
  SettingsListHeader,
  SettingsPageDescription,
  SettingsRemoveButton,
  SettingsSection,
  Toggle,
} from './controls';

const USAGE_SECTION_LABELS: Record<SettingsPromptUsageSectionId, TranslationKey> = {
  core: 'settings.prompt.usage.sections.core',
  workflow: 'settings.prompt.usage.sections.workflow',
  custom: 'settings.prompt.usage.sections.custom',
  tools: 'settings.prompt.usage.sections.tools',
  mcp: 'settings.prompt.usage.sections.mcp',
};

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  return mounted;
}

function PromptUsagePanel({ usage }: { readonly usage: SettingsPromptUsageSnapshot }) {
  const t = useT();
  const total = Math.max(usage.totalEstimatedTokens, 0);
  return (
    <div className="pivi-prompt-usage">
      <div className="pivi-prompt-usage__bar" role="img" aria-label={t('settings.prompt.usage.barAria')}>
        {usage.sections.map((section) => {
          const width = total === 0 ? 0 : (section.estimatedTokens / total) * 100;
          return (
            <span
              key={section.id}
              className={`pivi-prompt-usage__segment pivi-prompt-usage__segment--${section.id}`}
              style={{ width: `${width}%` }}
              title={t(USAGE_SECTION_LABELS[section.id])}
            />
          );
        })}
      </div>
      <ul className="pivi-prompt-usage__rows">
        {usage.sections.map((section) => (
          <UsageRow key={section.id} section={section} />
        ))}
        <li className="pivi-prompt-usage__row pivi-prompt-usage__row--total">
          <span className="pivi-prompt-usage__name">{t('settings.prompt.usage.total')}</span>
          <span className="pivi-prompt-usage__estimate">
            {t('settings.prompt.usage.estimatedTokens', { count: formatCompactTokenCount(usage.totalEstimatedTokens) })}
          </span>
        </li>
      </ul>
    </div>
  );
}

function UsageRow({ section }: { readonly section: SettingsPromptUsageSection }) {
  const t = useT();
  return (
    <li className="pivi-prompt-usage__row">
      <span className="pivi-prompt-usage__name">{t(USAGE_SECTION_LABELS[section.id])}</span>
      <span className="pivi-prompt-usage__estimate">
        {t('settings.prompt.usage.estimatedTokens', { count: formatCompactTokenCount(section.estimatedTokens) })}
      </span>
    </li>
  );
}

function PromptModuleCard({
  module,
  expanded,
  pending,
  position,
  dragging = false,
  dragOffset = 0,
  reorderHandleProps,
  suppressReorderClick,
  onToggleExpanded,
  onToggleEnabled,
  onSaveBody,
  onRestore,
  onRename,
  onDelete,
}: {
  readonly module: SettingsPromptModuleView;
  readonly expanded: boolean;
  readonly pending: boolean;
  readonly position?: number;
  readonly dragging?: boolean;
  readonly dragOffset?: number;
  readonly reorderHandleProps?: SortableReorderHandleProps<HTMLElement>;
  readonly suppressReorderClick?: () => boolean;
  readonly onToggleExpanded: () => void;
  readonly onToggleEnabled?: (enabled: boolean) => void;
  readonly onSaveBody: (body: string) => Promise<void>;
  readonly onRestore?: () => void;
  readonly onRename?: (title: string) => Promise<void>;
  readonly onDelete?: () => void;
}) {
  const t = useT();
  const [body, setBody] = useState(module.body);
  const [title, setTitle] = useState(module.title);
  const sortable = Boolean(reorderHandleProps);

  useEffect(() => { setBody(module.body); }, [module.body]);
  useEffect(() => { setTitle(module.title); }, [module.title]);

  const stop = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const dragStyle = dragging
    ? { '--pivi-provider-drag-y': `${dragOffset}px` } as CSSProperties
    : undefined;
  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    if ((event.target as Element).closest('button, input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    reorderHandleProps?.onPointerDown(event);
  };

  return (
    <details
      className={`pivi-provider-card pivi-prompt-module-card${sortable ? ' pivi-sortable-provider-card' : ''}${dragging ? ' is-dragging' : ''}${module.enabled ? '' : ' pivi-provider-card-disabled'}`}
      open={expanded}
      data-prompt-sort-id={sortable ? module.id : undefined}
      style={dragStyle}
    >
      <summary
        className="pivi-provider-header"
        onClick={(event) => {
          event.preventDefault();
          if (suppressReorderClick?.()) return;
          onToggleExpanded();
        }}
        onPointerCancel={(event) => reorderHandleProps?.onPointerCancel(event)}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => reorderHandleProps?.onPointerMove(event)}
        onPointerUp={(event) => reorderHandleProps?.onPointerUp(event)}
      >
        {reorderHandleProps && position !== undefined
          ? (
            <button
              type="button"
              className="pivi-provider-drag-handle"
              aria-label={t('settings.prompt.reorder.handle', { title: module.title, position })}
              aria-pressed={dragging}
              disabled={pending}
              onClick={stop}
              onKeyDown={reorderHandleProps.onKeyDown}
            >
              <span aria-hidden="true">⠿</span>
            </button>
          )
          : null}
        {position !== undefined ? <span className="pivi-provider-priority" aria-hidden="true">{position}</span> : null}
        <div className="pivi-provider-title-row">
          <span className="pivi-provider-title">{module.title}</span>
          {module.modified
            ? <span className="pivi-prompt-module-badge">{t('settings.prompt.modified')}</span>
            : null}
        </div>
        <SettingsItemActions>
          {onRestore
            ? (
              <button
                className="pivi-settings-text-btn"
                type="button"
                disabled={pending || !module.modified}
                onClick={(event) => { stop(event); onRestore(); }}
              >
                {t('settings.prompt.restore')}
              </button>
            )
            : null}
          {onToggleEnabled
            ? (
              <Toggle
                checked={module.enabled}
                disabled={pending}
                label={module.enabled
                  ? t('settings.prompt.disableAria', { title: module.title })
                  : t('settings.prompt.enableAria', { title: module.title })}
                onChange={onToggleEnabled}
              />
            )
            : null}
          {onDelete
            ? (
              <SettingsRemoveButton
                ariaLabel={t('settings.prompt.deleteAria', { title: module.title })}
                disabled={pending}
                onClick={(event) => { stop(event); onDelete(); }}
              />
            )
            : null}
        </SettingsItemActions>
      </summary>
      <div className="pivi-provider-body">
        {onRename
          ? (
            <label className="pivi-setting-row">
              <div className="pivi-setting-row__info">
                <div className="pivi-setting-row__name">{t('settings.prompt.titleLabel')}</div>
              </div>
              <div className="pivi-setting-row__control">
                <input
                  className="pivi-settings-control"
                  value={title}
                  disabled={pending}
                  onChange={(event) => { setTitle(event.target.value); }}
                  onBlur={() => {
                    if (title.trim() === module.title) return;
                    void onRename(title);
                  }}
                />
              </div>
            </label>
          )
          : null}
        <label className="pivi-command-prompt-field">
          <span className="pivi-setting-row__name">{t('settings.prompt.bodyLabel')}</span>
          <textarea
            className="pivi-settings-control pivi-settings-control--fill pivi-prompt-module-body"
            rows={16}
            value={body}
            disabled={pending}
            onChange={(event) => { setBody(event.target.value); }}
            onBlur={() => {
              if (body === module.body) return;
              void onSaveBody(body);
            }}
          />
        </label>
      </div>
    </details>
  );
}

export function PromptTab({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const mounted = useMountedRef();
  const [modules, setModules] = useState<readonly SettingsPromptModuleView[]>(() => ports.prompt.listModules());
  const [catalogRevision, setCatalogRevision] = useState(() => ports.prompt.getCatalogRevision());
  const [usage, setUsage] = useState<SettingsPromptUsageSnapshot>(() => ports.prompt.getUsage());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<SettingsPromptModuleView | null>(null);
  const [pending, setPending] = useState(false);
  const [customOrder, setCustomOrder] = useState<readonly string[]>(() => (
    ports.prompt.listModules().filter((module) => module.kind === 'custom').map((module) => module.id)
  ));

  const reload = useCallback(() => {
    if (!mounted.current) return;
    const next = ports.prompt.listModules();
    setModules(next);
    setCatalogRevision(ports.prompt.getCatalogRevision());
    setUsage(ports.prompt.getUsage());
    setCustomOrder(next.filter((module) => module.kind === 'custom').map((module) => module.id));
  }, [mounted, ports.prompt]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    try {
      await action();
      reload();
    } catch (cause) {
      reload();
      ports.feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const toggleExpanded = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const workflowModules = modules.filter((module) => module.kind === 'workflow');
  const customById = useMemo(
    () => new Map(modules.filter((module) => module.kind === 'custom').map((module) => [module.id, module])),
    [modules],
  );

  const reorder = useSortableReorder<string, HTMLElement>({
    order: customOrder,
    disabled: pending || customOrder.length < 2,
    itemSelector: '[data-prompt-sort-id]',
    itemDataKey: 'promptSortId',
    setOrder: (ids) => { setCustomOrder(ids); },
    commitOrder: async (ids, originalOrder) => {
      setPending(true);
      try {
        await ports.prompt.reorderCustomModules(ids, catalogRevision);
        reload();
        return true;
      } catch (cause) {
        setCustomOrder([...originalOrder]);
        reload();
        ports.feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
        return false;
      } finally {
        setPending(false);
      }
    },
    positionAnnouncement: (id, position, total) => {
      const module = customById.get(id);
      return t('settings.prompt.reorder.position', {
        title: module?.title ?? id,
        position,
        total,
      });
    },
    savedAnnouncement: t('settings.prompt.reorder.saved'),
    cancelledAnnouncement: t('settings.prompt.reorder.cancelled'),
    failedAnnouncement: t('common.error'),
  });

  const saveDraft = async (): Promise<void> => {
    setPending(true);
    try {
      const created = await ports.prompt.createCustomModule({
        title: draftTitle.trim() || t('settings.prompt.newModule'),
        body: draftBody,
        enabled: true,
      }, catalogRevision);
      if (mounted.current) {
        setDraftOpen(false);
        setDraftTitle('');
        setDraftBody('');
        setExpanded((current) => {
          const next = new Set(current);
          next.add(created.id);
          return next;
        });
        reload();
      }
    } catch (cause) {
      reload();
      ports.feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return (
    <div className="pivi-prompt-tab">
      <SettingsPageDescription>
        <p className="pivi-setting-description">{t('settings.prompt.pageDescription')}</p>
      </SettingsPageDescription>
      <SettingsSection title={t('settings.prompt.usage.heading')} headingId="pivi-prompt-usage">
        <PromptUsagePanel usage={usage} />
      </SettingsSection>
      <SettingsSection title={t('settings.prompt.workflow.heading')} headingId="pivi-prompt-workflow">
        <div className="pivi-providers-list">
          {workflowModules.map((module) => (
            <PromptModuleCard
              key={module.id}
              module={module}
              expanded={expanded.has(module.id)}
              pending={pending}
              onToggleExpanded={() => toggleExpanded(module.id)}
              onToggleEnabled={(enabled) => { void run(() => ports.prompt.setWorkflowEnabled(module.id, enabled, catalogRevision)); }}
              onSaveBody={(body) => run(() => ports.prompt.saveCustomBody(module.id, body, catalogRevision))}
              onRestore={() => { void run(() => ports.prompt.restoreShipped(module.id, catalogRevision)); }}
            />
          ))}
        </div>
      </SettingsSection>
      <SettingsListHeader title={t('settings.prompt.custom.heading')} />
      {customOrder.length === 0 && !draftOpen
        ? <p className="pivi-sp-empty-state">{t('settings.prompt.empty')}</p>
        : (
          <div className="pivi-providers-list" ref={reorder.listRef}>
            {customOrder.map((id, index) => {
              const module = customById.get(id);
              if (!module) return null;
              return (
                <PromptModuleCard
                  key={id}
                  module={module}
                  expanded={expanded.has(id)}
                  pending={pending}
                  position={index + 1}
                  dragging={reorder.draggingId === id}
                  dragOffset={reorder.draggingId === id ? reorder.dragOffset : 0}
                  reorderHandleProps={reorder.getHandleProps(id)}
                  suppressReorderClick={() => reorder.consumeClickAfterDrag(id)}
                  onToggleExpanded={() => toggleExpanded(id)}
                  onToggleEnabled={(enabled) => { void run(() => ports.prompt.setCustomModuleEnabled(id, enabled, catalogRevision)); }}
                  onSaveBody={(body) => run(() => ports.prompt.editCustomModule(id, body, catalogRevision))}
                  onRename={(title) => run(() => ports.prompt.renameCustomModule(id, title, catalogRevision))}
                  onDelete={() => { setConfirmDelete(module); }}
                />
              );
            })}
            {draftOpen
              ? (
                <details className="pivi-provider-card pivi-prompt-module-card" open>
                  <summary className="pivi-provider-header" onClick={(event) => { event.preventDefault(); }}>
                    <div className="pivi-provider-title-row">
                      <span className="pivi-provider-title">{draftTitle.trim() || t('settings.prompt.newModule')}</span>
                    </div>
                    <SettingsItemActions>
                      <button
                        className="pivi-settings-text-btn"
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setDraftOpen(false);
                          setDraftTitle('');
                          setDraftBody('');
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </SettingsItemActions>
                  </summary>
                  <form
                    className="pivi-provider-body"
                    onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}
                  >
                    <label className="pivi-setting-row">
                      <div className="pivi-setting-row__info">
                        <div className="pivi-setting-row__name">{t('settings.prompt.titleLabel')}</div>
                      </div>
                      <div className="pivi-setting-row__control">
                        <input
                          className="pivi-settings-control"
                          autoFocus
                          value={draftTitle}
                          disabled={pending}
                          onChange={(event) => { setDraftTitle(event.target.value); }}
                        />
                      </div>
                    </label>
                    <label className="pivi-command-prompt-field">
                      <span className="pivi-setting-row__name">{t('settings.prompt.bodyLabel')}</span>
                      <textarea
                        className="pivi-settings-control pivi-settings-control--fill pivi-prompt-module-body"
                        rows={16}
                        value={draftBody}
                        disabled={pending}
                        onChange={(event) => { setDraftBody(event.target.value); }}
                      />
                    </label>
                    <div className="pivi-command-card-actions">
                      <button className="pivi-button--primary" type="submit" disabled={pending}>
                        {t('common.save')}
                      </button>
                    </div>
                  </form>
                </details>
              )
              : null}
          </div>
        )}
      <div className="pivi-visually-hidden" aria-live="polite">{reorder.announcement}</div>
      <div className="pivi-provider-add-controls">
        <button
          className="pivi-provider-add-trigger"
          type="button"
          aria-label={t('settings.prompt.addAria')}
          disabled={pending || draftOpen}
          onClick={() => { setDraftOpen(true); }}
        >
          {t('settings.prompt.add')}
        </button>
      </div>
      {confirmDelete
        ? (
          <ModalLayer
            ariaLabel={t('settings.prompt.deleteConfirmTitle', { title: confirmDelete.title })}
            initialFocus="cancel"
            open
            onClose={() => { if (!pending) setConfirmDelete(null); }}
          >
            <div className="pivi-modal">
              <div className="pivi-modal__title">
                {t('settings.prompt.deleteConfirmTitle', { title: confirmDelete.title })}
              </div>
              <p>{t('settings.prompt.deleteConfirm', { title: confirmDelete.title })}</p>
              <div className="pivi-modal__actions">
                <button
                  type="button"
                  data-modal-cancel
                  disabled={pending}
                  onClick={() => setConfirmDelete(null)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="pivi-button--danger"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const id = confirmDelete.id;
                    setConfirmDelete(null);
                    void run(() => ports.prompt.deleteCustomModule(id, catalogRevision));
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </ModalLayer>
        )
        : null}
    </div>
  );
}
