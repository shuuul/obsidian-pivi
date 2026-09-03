import { useEffect, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsPorts } from '../ports';
import { AboutSettingsTab } from './AboutSettingsTab';
import { BuiltInToolsSection } from './BuiltInToolsSection';
import { CommandsTab } from './CommandsTab';
import { McpToolsSection } from './McpToolsSection';
import { ModelsSettingsTab } from './ModelsSettingsTab';
import { SETTINGS_PAGES, type SettingsPageId } from './navigation';
import { SettingsPage } from './primitives';
import { PromptTab } from './PromptTab';
import { SettingsUiStore } from './SettingsUiStore';
import { EnvironmentSection, GeneralSettingsTab, ToolbarSettingsTab } from './SimpleSettingsTabs';
import { SkillsSettingsTab } from './SkillsSettingsTab';
import { WebToolsSection } from './WebToolsSection';

export interface SettingsRootProps {
  readonly ports: SettingsPorts;
  readonly store?: SettingsUiStore;
  readonly page: SettingsPageId;
}

/** React owner for one native settings page. */
export function SettingsRoot({ ports, store: suppliedStore, page }: SettingsRootProps) {
  const t = useT();
  const [ownedStore] = useState(() => new SettingsUiStore(ports.snapshot.getSnapshot()));
  const store = suppliedStore ?? ownedStore;
  useEffect(() => () => { if (!suppliedStore) store.dispose(); }, [store, suppliedStore]);
  switch (page) {
    case 'general':
    case 'appearance':
    case 'chat':
    case 'personalization':
    case 'input':
    case 'sessions':
      return (
        <SettingsPage description={page === 'chat' || page === 'personalization' || page === 'input' || page === 'sessions'
          ? <p>{t(SETTINGS_PAGES[page].descriptionKey)}</p>
          : undefined}
        >
          <GeneralSettingsTab
            page={page}
            store={store}
            actions={ports.actions}
            feedback={ports.feedback}
            hotkeys={ports.hotkeys}
            integrations={ports.hostIntegrations}
          />
        </SettingsPage>
      );
    case 'about':
      return <SettingsPage><AboutSettingsTab about={ports.about} /></SettingsPage>;
    case 'environment':
      return <EnvironmentSection environment={ports.environment} feedback={ports.feedback} />;
    case 'models':
      return <ModelsSettingsTab models={ports.complex.models} catalog={ports.catalog} feedback={ports.feedback} />;
    case 'builtInTools':
      return <BuiltInToolsSection ports={ports} store={store} />;
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
