import {
  buildMcpInventoryLines,
  buildRegisteredToolsSection,
  composePromptSections,
  createCustomPromptModuleId,
  type CustomPromptModule,
  estimatePromptUsageSections,
  getShippedPromptModule,
  isShippedPromptModuleId,
  normalizePromptModuleSettings,
  type PromptModuleOverride,
  type PromptModuleSettings,
  resolvePromptModules,
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

function toModuleView(
  module: ReturnType<typeof resolvePromptModules>[number],
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

function requireCustomModule(
  modules: readonly CustomPromptModule[],
  id: string,
): CustomPromptModule {
  const entry = modules.find((module) => module.id === id);
  if (!entry) {
    throw new Error(`Custom prompt module ${id} was not found.`);
  }
  return entry;
}

function requireWorkflowModule(id: string): void {
  const shipped = getShippedPromptModule(id);
  if (!shipped || shipped.kind !== 'workflow') {
    throw new Error(`Workflow prompt module ${id} was not found.`);
  }
}

function writeOverride(
  current: PromptModuleSettings,
  id: string,
  patch: PromptModuleOverride,
): Record<string, PromptModuleOverride> {
  const shipped = getShippedPromptModule(id);
  const existing = current.promptModules[id] ?? {};
  const next: { enabled?: boolean; customBody?: string } = {};
  const enabled = patch.enabled ?? existing.enabled;
  const customBody = Object.hasOwn(patch, 'customBody') ? patch.customBody : existing.customBody;
  if (enabled !== undefined && shipped && enabled !== shipped.defaultEnabled) {
    next.enabled = enabled;
  }
  if (customBody !== undefined) {
    next.customBody = customBody;
  }
  const overrides = { ...current.promptModules };
  if (next.enabled === undefined && next.customBody === undefined) {
    delete overrides[id];
  } else {
    overrides[id] = next;
  }
  return overrides;
}

export function createSettingsPromptPort(
  host: PiviSettingsHost,
  workspace: PiviPluginWorkspace,
  refreshPrompt: () => Promise<void>,
): SettingsPromptPort {
  const readSettings = (): PromptModuleSettings => normalizePromptModuleSettings(
    host.settings.promptModules,
    host.settings.customPromptModules,
  );

  const persist = async (next: PromptModuleSettings): Promise<void> => {
    host.settings.promptModules = { ...next.promptModules };
    host.settings.customPromptModules = next.customPromptModules.map((entry) => ({ ...entry }));
    await host.saveSettings();
    await refreshPrompt();
  };

  const listModules = (): readonly SettingsPromptModuleView[] => {
    const settings = readSettings();
    return resolvePromptModules(settings.promptModules, settings.customPromptModules)
      .map(toModuleView);
  };

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
    const settings = readSettings();
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
      requireWorkflowModule(id);
      const current = readSettings();
      await persist({
        promptModules: writeOverride(current, id, { enabled }),
        customPromptModules: current.customPromptModules,
      });
    },
    async saveCustomBody(id, customBody) {
      requireWorkflowModule(id);
      const current = readSettings();
      await persist({
        promptModules: writeOverride(current, id, { customBody }),
        customPromptModules: current.customPromptModules,
      });
    },
    async restoreShipped(id) {
      requireWorkflowModule(id);
      const current = readSettings();
      const existing = current.promptModules[id];
      const overrides = { ...current.promptModules };
      if (!existing || existing.enabled === undefined) {
        delete overrides[id];
      } else {
        overrides[id] = { enabled: existing.enabled };
      }
      await persist({
        promptModules: overrides,
        customPromptModules: current.customPromptModules,
      });
    },
    async createCustomModule(input?: SettingsPromptCreateInput) {
      const current = readSettings();
      const id = createCustomPromptModuleId();
      const entry: CustomPromptModule = {
        id,
        title: input?.title?.trim() || 'New module',
        body: input?.body ?? '',
        enabled: input?.enabled ?? true,
      };
      await persist({
        promptModules: current.promptModules,
        customPromptModules: [...current.customPromptModules, entry],
      });
      return toModuleView({
        ...entry,
        kind: 'custom',
        modified: false,
      });
    },
    async renameCustomModule(id, title) {
      const current = readSettings();
      requireCustomModule(current.customPromptModules, id);
      await persist({
        promptModules: current.promptModules,
        customPromptModules: current.customPromptModules.map((entry) => (
          entry.id === id ? { ...entry, title } : entry
        )),
      });
    },
    async editCustomModule(id, body) {
      const current = readSettings();
      requireCustomModule(current.customPromptModules, id);
      await persist({
        promptModules: current.promptModules,
        customPromptModules: current.customPromptModules.map((entry) => (
          entry.id === id ? { ...entry, body } : entry
        )),
      });
    },
    async reorderCustomModules(ids) {
      const current = readSettings();
      const byId = new Map(current.customPromptModules.map((entry) => [entry.id, entry]));
      const next: CustomPromptModule[] = [];
      for (const id of ids) {
        if (isShippedPromptModuleId(id)) {
          continue;
        }
        const entry = byId.get(id);
        if (entry) {
          next.push(entry);
          byId.delete(id);
        }
      }
      for (const entry of byId.values()) {
        next.push(entry);
      }
      await persist({
        promptModules: current.promptModules,
        customPromptModules: next,
      });
    },
    async setCustomModuleEnabled(id, enabled) {
      const current = readSettings();
      requireCustomModule(current.customPromptModules, id);
      await persist({
        promptModules: current.promptModules,
        customPromptModules: current.customPromptModules.map((entry) => (
          entry.id === id ? { ...entry, enabled } : entry
        )),
      });
    },
    async deleteCustomModule(id) {
      const current = readSettings();
      requireCustomModule(current.customPromptModules, id);
      await persist({
        promptModules: current.promptModules,
        customPromptModules: current.customPromptModules.filter((entry) => entry.id !== id),
      });
    },
  };
}
