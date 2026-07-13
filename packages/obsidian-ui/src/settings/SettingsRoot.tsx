import { useEffect, useState } from 'react';

import type { SettingsPorts } from '../ports';
import { CommandsTab } from './CommandsTab';
import { McpTab } from './McpTab';
import { ModelsSettingsTab } from './ModelsSettingsTab';
import { SettingsShell } from './SettingsShell';
import { SettingsUiStore } from './SettingsUiStore';
import { GeneralSettingsTab, IntegrationsSettingsTab, SubagentsSettingsTab } from './SimpleSettingsTabs';
import { SkillsSettingsTab } from './SkillsSettingsTab';
import { ToolsTab } from './ToolsTab';
import type { SettingsTabId } from './types';
import { WebSearchTab } from './WebSearchTab';

export interface SettingsRootProps {
  readonly ports: SettingsPorts;
  readonly store?: SettingsUiStore;
  readonly initialTab?: SettingsTabId;
}

/** React owner for the settings pages whose narrow port contracts are complete. */
export function SettingsRoot({ ports, store: suppliedStore, initialTab }: SettingsRootProps) {
  const [ownedStore] = useState(() => new SettingsUiStore(ports.snapshot.getSnapshot()));
  const store = suppliedStore ?? ownedStore;
  useEffect(() => () => { if (!suppliedStore) store.dispose(); }, [store, suppliedStore]);
  return <SettingsShell initialTab={initialTab}>{(activeTab) => {
    switch (activeTab) {
      case 'general': return (
        <GeneralSettingsTab
          store={store}
          actions={ports.actions}
          environment={ports.environment}
          hotkeys={ports.hotkeys}
        />
      );
      case 'models': return <ModelsSettingsTab models={ports.complex.models} catalog={ports.catalog} />;
      case 'skills': return <SkillsSettingsTab skills={ports.complex.skills} />;
      case 'subagents': return <SubagentsSettingsTab store={store} actions={ports.actions} />;
      case 'tools': return <ToolsTab ports={ports} />;
      case 'webSearch': return <WebSearchTab ports={ports} />;
      case 'commands': return <CommandsTab ports={ports} />;
      case 'mcp': return <McpTab mcp={ports.complex.mcp} />;
      case 'integrations': return <IntegrationsSettingsTab actions={ports.actions} />;
      default: return null;
    }
  }}</SettingsShell>;
}
