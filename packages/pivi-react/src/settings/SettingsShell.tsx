import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import type { TranslationKey } from '../i18n';
import { useT } from '../i18n';
import type { SettingsTabId } from './types';

const TABS: readonly { readonly id: SettingsTabId; readonly label: TranslationKey }[] = [
  { id: 'general', label: 'settings.tabs.general' },
  { id: 'models', label: 'settings.tabs.models' },
  { id: 'skills', label: 'settings.tabs.skills' },
  { id: 'tools', label: 'settings.tabs.tools' },
  { id: 'subagents', label: 'settings.tabs.subagents' },
  { id: 'commands', label: 'settings.tabs.commands' },
  { id: 'toolbar', label: 'settings.tabs.toolbar' },
];

export interface SettingsShellProps {
  readonly initialTab?: SettingsTabId;
  readonly children: (activeTab: SettingsTabId) => ReactNode;
}

export function SettingsShell({ initialTab = 'general', children }: SettingsShellProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const tabRefs = useRef(new Map<SettingsTabId, HTMLButtonElement>());
  const idPrefix = useId();
  const t = useT();
  const panelId = `${idPrefix}-panel`;

  useEffect(() => {
    tabRefs.current.get(activeTab)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
        break;
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    tabRefs.current.get(nextTab.id)?.focus();
  };

  return (
    <div className="pivi-settings">
      <div className="pivi-settings-tabs" role="tablist" aria-label={t('settings.tabs.ariaLabel')}>
        {TABS.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              className={`pivi-settings-tab${selected ? ' pivi-settings-tab--active' : ''}`}
              role="tab"
              aria-controls={panelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => selectFromKeyboard(event, index)}
            >
              {t(tab.label)}
            </button>
          );
        })}
      </div>
      <div
        id={panelId}
        className="pivi-settings-content"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${activeTab}`}
      >
        {children(activeTab)}
      </div>
    </div>
  );
}
