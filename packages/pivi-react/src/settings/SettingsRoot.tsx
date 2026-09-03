import { useEffect, useState } from 'react';

import type { SettingsPorts } from '../ports';
import { AboutSettingsTab } from './AboutSettingsTab';
import { BuiltInToolsSection } from './BuiltInToolsSection';
import { CommandsTab } from './CommandsTab';
import { McpToolsSection } from './McpToolsSection';
import { ModelsSettingsTab } from './ModelsSettingsTab';
import type { SettingsPageId } from './navigation';
import { PromptTab } from './PromptTab';
import { SettingsUiStore } from './SettingsUiStore';
import { EnvironmentSection, GeneralSettingsTab, SubagentsSettingsTab, ToolbarSettingsTab } from './SimpleSettingsTabs';
import { SkillsSettingsTab } from './SkillsSettingsTab';
import { WebToolsSection } from './WebToolsSection';

export interface SettingsRootProps {
  readonly ports: SettingsPorts;
  readonly store?: SettingsUiStore;
  readonly page: SettingsPageId;
}

/** React owner for one native settings page. */
export function SettingsRoot({ ports, store: suppliedStore, page }: SettingsRootProps) {
  const [ownedStore] = useState(() => new SettingsUiStore(ports.snapshot.getSnapshot()));
  const store = suppliedStore ?? ownedStore;
  useEffect(() => () => { if (!suppliedStore) store.dispose(); }, [store, suppliedStore]);
  switch (page) {
    case 'general':
      return (
        <>
          <GeneralSettingsTab
            store={store}
            actions={ports.actions}
            feedback={ports.feedback}
            hotkeys={ports.hotkeys}
            integrations={ports.hostIntegrations}
          />
          <AboutSettingsTab about={ports.about} />
        </>
      );
    case 'environment':
      return <EnvironmentSection environment={ports.environment} feedback={ports.feedback} />;
    case 'models':
      return <ModelsSettingsTab models={ports.complex.models} catalog={ports.catalog} feedback={ports.feedback} />;
    case 'builtInTools':
      return (
        <>
          <BuiltInToolsSection ports={ports} />
          <SubagentsSettingsTab store={store} actions={ports.actions} feedback={ports.feedback} />
        </>
      );
    case 'webTools':
      return <WebToolsSection ports={ports} />;
    case 'mcpServers':
      return <McpToolsSection mcp={ports.complex.mcp} feedback={ports.feedback} />;
    case 'skills':
      return <SkillsSettingsTab skills={ports.complex.skills} feedback={ports.feedback} />;
    case 'prompt':
      return <PromptTab ports={ports} />;
    case 'commands':
      return <CommandsTab ports={ports} />;
    case 'toolbar':
      return (
        <ToolbarSettingsTab
          store={store}
          actions={ports.actions}
          editorToolbar={ports.editorToolbar}
          feedback={ports.feedback}
          integrations={ports.hostIntegrations}
        />
      );
    default: {
      const _exhaustive: never = page;
      return _exhaustive;
    }
  }
}
