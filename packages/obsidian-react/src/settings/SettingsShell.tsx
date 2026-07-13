import { type ReactNode, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsTabId } from './types';

const TAB_IDS: readonly SettingsTabId[] = [
  'general', 'models', 'skills', 'tools', 'subagents', 'webSearch', 'commands', 'mcp', 'integrations',
];

export interface SettingsShellProps {
  readonly initialTab?: SettingsTabId;
  readonly children: (activeTab: SettingsTabId) => ReactNode;
}

export function SettingsShell({ initialTab = 'general', children }: SettingsShellProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const t = useT();
  return <div className="pivi-settings"><div className="pivi-settings-tabs" role="tablist">{TAB_IDS.map((tab) => <button key={tab} type="button" className={`pivi-settings-tab${activeTab === tab ? ' pivi-settings-tab--active' : ''}`} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{t(`settings.tabs.${tab}`)}</button>)}</div><div className="pivi-settings-content" role="tabpanel">{children(activeTab)}</div></div>;
}
