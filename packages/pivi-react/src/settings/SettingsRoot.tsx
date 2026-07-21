import { useEffect, useState } from 'react';

import type { SettingsPorts } from '../ports';
import { CommandsTab } from './CommandsTab';
import { ModelsSettingsTab } from './ModelsSettingsTab';
import { SettingsShell } from './SettingsShell';
import { SettingsUiStore } from './SettingsUiStore';
import { GeneralSettingsTab, SubagentsSettingsTab, ToolbarSettingsTab } from './SimpleSettingsTabs';
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
        <GeneralSettingsTab
          store={store}
          actions={ports.actions}
          environment={ports.environment}
          feedback={ports.feedback}
          hotkeys={ports.hotkeys}
          integrations={ports.hostIntegrations}
        />
      );
      case 'toolbar': return (
        <ToolbarSettingsTab
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
          integrations={ports.hostIntegrations}
        />
      );
      case 'models': return <ModelsSettingsTab models={ports.complex.models} catalog={ports.catalog} feedback={ports.feedback} />;
      case 'skills': return <SkillsSettingsTab skills={ports.complex.skills} feedback={ports.feedback} />;
      case 'subagents': return <SubagentsSettingsTab store={store} actions={ports.actions} feedback={ports.feedback} />;
      case 'tools': return <ToolsSettingsPage ports={ports} />;
      case 'commands': return <CommandsTab ports={ports} />;
      default: return null;
    }
  }}</SettingsShell>;
}
