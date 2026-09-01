import {
  buildMcpInventoryLines,
  buildRegisteredToolsSection,
  composePromptSections,
  estimatePromptUsageSections,
  type ResolvedPromptModule,
} from '@pivi/agent/prompt';
import {
  getObsidianToolsSettingsFromBag,
  getSubagentRuntimeSettingsFromBag,
} from '@pivi/agent/settings/types';
import {
  isObsidianAgentTool,
  TOOL_MCP,
  TOOL_OBSIDIAN_BASH,
  TOOL_SKILL,
  TOOL_SPAWN_AGENT,
  type ToolSpec,
} from '@pivi/agent/tools';
import {
  buildEffectiveBashAllowlist,
  createObsidianTools,
  resolveLoginShellPath,
} from '@pivi/obsidian-tools';
import type {
  SettingsPromptCreateInput,
  SettingsPromptModuleView,
  SettingsPromptPort,
  SettingsPromptUsageSnapshot,
} from '@pivi/pivi-react/ports';

import type { PiviPluginWorkspace, PiviSettingsHost } from '@/app/hostContracts';
import { isOfficialObsidianCliEnabled } from '@/app/hostPlatform';
import { createPromptCompositionCoordinator } from '@/app/runtime/PromptCompositionCoordinator';

function toModuleView(
  module: ResolvedPromptModule,
): SettingsPromptModuleView {
  return {
    id: module.id,
    kind: module.kind,
    title: module.title,
    enabled: module.enabled,
    modified: module.kind === 'core' ? false : module.modified,
    body: module.body,
  };
}

export function createSettingsPromptPort(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
  refreshPrompt: () => Promise<void>,
): SettingsPromptPort {
  const composition = createPromptCompositionCoordinator(host);

  const persistAndRefresh = async (work: () => Promise<unknown>): Promise<void> => {
    await work();
    await refreshPrompt();
  };

  const listModules = (): readonly SettingsPromptModuleView[] => (
    composition.listModules().map(toModuleView)
  );

  const collectToolSpecs = (): readonly ToolSpec[] => {
    if (!host.app) {
      return [];
    }
    const toolsSettings = getObsidianToolsSettingsFromBag(host.settings);
    return createObsidianTools(host.app, toolsSettings, {
      obsidianCliAvailable: toolsSettings.cliEnabled && isOfficialObsidianCliEnabled(),
      imageGenerator: workspace.providerOAuth?.hasCodexAuth()
        ? {
          generateImage() {
            return Promise.reject(new Error('Prompt usage estimation does not generate images.'));
          },
        }
        : undefined,
    });
  };

  const collectMcpInventory = () => {
    const servers = workspace.mcpServerManager.getServers()
      .filter((server) => server.enabled);
    return servers.map((server) => ({
      name: server.name,
      tools: workspace.mcpToolProvider.getCachedTools(server.name),
    }));
  };

  const getUsage = (): SettingsPromptUsageSnapshot => {
    const settings = composition.read();
    const toolSpecs = collectToolSpecs();
    const toolsSettings = getObsidianToolsSettingsFromBag(host.settings);
    const subagents = getSubagentRuntimeSettingsFromBag(host.settings);
    const mcpInventory = collectMcpInventory();
    const includeMcp = mcpInventory.length > 0;
    const includeSubagent = subagents.enabled;
    const obsidianTools = toolSpecs.map((spec) => spec.name).filter(isObsidianAgentTool);
    const registeredToolNames = [
      ...toolSpecs.map((spec) => spec.name),
      TOOL_SKILL,
      ...(includeSubagent ? [TOOL_SPAWN_AGENT] : []),
      ...(includeMcp ? [TOOL_MCP] : []),
    ];
    const composed = composePromptSections({
      overrides: settings.promptModules,
      custom: settings.customPromptModules,
      userName: host.settings.userName,
      registeredToolNames,
    });
    const toolsText = buildRegisteredToolsSection({
      obsidianTools,
      toolSpecs,
      obsidianCliAvailable: toolsSettings.cliEnabled && isOfficialObsidianCliEnabled(),
      ...(obsidianTools.includes(TOOL_OBSIDIAN_BASH)
        ? { bashAllowlist: buildEffectiveBashAllowlist(toolsSettings.bashAllowlist, resolveLoginShellPath()) }
        : {}),
      includeMcp: false,
      includeSkill: true,
      includeSubagent,
      maxConcurrentSubagents: subagents.maxConcurrentSubagents,
      includeWebSearch: true,
    });
    const mcpHeading = includeMcp
      ? [
        '### MCP',
        `- \`${TOOL_MCP}\` — Vault MCP servers (.pivi/mcp.json). All settings-enabled servers are available; use search/list before calling tools.`,
        ...buildMcpInventoryLines(mcpInventory),
      ].join('\n')
      : buildMcpInventoryLines(mcpInventory).join('\n');
    const sections = estimatePromptUsageSections({
      core: composed.core,
      workflow: composed.workflow,
      custom: composed.custom,
      tools: toolsText,
      mcp: mcpHeading,
    });
    return {
      sections,
      totalEstimatedTokens: sections.reduce((sum, section) => sum + section.estimatedTokens, 0),
    };
  };

  return {
    listModules,
    getUsage,
    async setWorkflowEnabled(id, enabled) {
      await persistAndRefresh(() => composition.setWorkflowEnabled(id, enabled));
    },
    async saveCustomBody(id, customBody) {
      await persistAndRefresh(() => composition.saveCustomBody(id, customBody));
    },
    async restoreShipped(id) {
      await persistAndRefresh(() => composition.restoreShipped(id));
    },
    async createCustomModule(input?: SettingsPromptCreateInput) {
      const created = await composition.createCustomModule(input);
      await refreshPrompt();
      return toModuleView(created);
    },
    async renameCustomModule(id, title) {
      await persistAndRefresh(() => composition.renameCustomModule(id, title));
    },
    async editCustomModule(id, body) {
      await persistAndRefresh(() => composition.editCustomModule(id, body));
    },
    async reorderCustomModules(ids) {
      await persistAndRefresh(() => composition.reorderCustomModules(ids));
    },
    async setCustomModuleEnabled(id, enabled) {
      await persistAndRefresh(() => composition.setCustomModuleEnabled(id, enabled));
    },
    async deleteCustomModule(id) {
      await persistAndRefresh(() => composition.deleteCustomModule(id));
    },
  };
}
