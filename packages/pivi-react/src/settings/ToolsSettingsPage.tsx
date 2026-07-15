import { useId } from 'react';

import { useT } from '../i18n';
import type { SettingsPorts } from '../ports';
import { BuiltInToolsSection } from './BuiltInToolsSection';
import { SettingsSection } from './controls';
import { McpToolsSection } from './McpToolsSection';
import { WebToolsSection } from './WebToolsSection';

export function ToolsSettingsPage({ ports }: { readonly ports: SettingsPorts }) {
  const t = useT();
  const idPrefix = useId();
  const builtInHeadingId = `${idPrefix}-built-in-tools-heading`;
  const webHeadingId = `${idPrefix}-web-tools-heading`;
  const mcpHeadingId = `${idPrefix}-mcp-tools-heading`;
  return (
    <div className="pivi-tools-settings-page">
      <SettingsSection title={t('settings.tools.sections.builtIn')} headingId={builtInHeadingId}>
        <BuiltInToolsSection ports={ports} />
      </SettingsSection>
      <SettingsSection title={t('settings.tools.sections.web')} headingId={webHeadingId}>
        <WebToolsSection ports={ports} />
      </SettingsSection>
      <SettingsSection title={t('settings.tools.sections.mcp')} headingId={mcpHeadingId}>
        <McpToolsSection mcp={ports.complex.mcp} />
      </SettingsSection>
    </div>
  );
}
