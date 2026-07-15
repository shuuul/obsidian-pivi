import { useEffect, useState } from 'react';

import type { SettingsPorts } from '../ports';
import { CommandsTab } from './CommandsTab';
import { ModelsSettingsTab } from './ModelsSettingsTab';
import { SettingsShell } from './SettingsShell';
import { SettingsUiStore } from './SettingsUiStore';
import { GeneralSettingsTab, IntegrationsSettingsSection, SubagentsSettingsTab } from './SimpleSettingsTabs';
import { SkillsSettingsTab } from './SkillsSettingsTab';
import { ToolsSettingsPage } from './ToolsSettingsPage';
import type { SettingsTabId } from './types';

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
        <>
          <GeneralSettingsTab
            store={store}
            actions={ports.actions}
            environment={ports.environment}
            hotkeys={ports.hotkeys}
          />
          <IntegrationsSettingsSection integrations={ports.hostIntegrations} />
        </>
      );
      case 'models': return <ModelsSettingsTab models={ports.complex.models} catalog={ports.catalog} />;
      case 'skills': return <SkillsSettingsTab skills={ports.complex.skills} />;
      case 'subagents': return <SubagentsSettingsTab store={store} actions={ports.actions} />;
      case 'tools': return <ToolsSettingsPage ports={ports} />;
      case 'commands': return <CommandsTab ports={ports} />;
      default: return null;
    }
  }}</SettingsShell>;
}
