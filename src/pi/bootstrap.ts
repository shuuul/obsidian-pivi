import { AgentServices } from "../core/agent/AgentServices";
import { AgentWorkspace } from "../core/agent/AgentWorkspace";
import type { AgentRegistration } from "../core/agent/types";
import {
  maybeGetPiWorkspaceServices,
  piWorkspaceRegistration,
} from "./app/PiWorkspaceServices";
import { resolvePiPlugin } from "./app/resolvePiHost";
import { PI_RUNTIME_CAPABILITIES } from "./capabilities";
import { PiChatRuntime } from "./runtime/PiChatRuntime";
import {
  agentSettingsReconciler,
  PiInlineEditService,
  PiSessionHistoryService,
  PiTaskResultInterpreter,
  PiTitleGenerationService,
} from "./services";
import {
  normalizePiAgentSettingsRecord,
  updatePiAgentSettings,
} from "./settings";
import { piChatUIConfig } from "./ui/PiChatUIConfig";

const piAgentRegistration: AgentRegistration = {
  capabilities: PI_RUNTIME_CAPABILITIES,
  chatUIConfig: piChatUIConfig,
  createInlineEditService: (host) =>
    new PiInlineEditService(resolvePiPlugin(host)),
  createRuntime: ({ host }) => {
    const plugin = resolvePiPlugin(host);
    const services = maybeGetPiWorkspaceServices();
    return new PiChatRuntime(
      plugin,
      services?.mcpServerManager ?? AgentWorkspace.getMcpServerManager(),
      services?.mcpOAuth ?? null,
    );
  },
  createTitleGenerationService: (host) =>
    new PiTitleGenerationService(resolvePiPlugin(host)),
  displayName: "Pi",
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiSessionHistoryService(),
  settingsPersistence: {
    normalizeSettingsRecord: normalizePiAgentSettingsRecord,
    updateSettings: updatePiAgentSettings,
  },
  settingsReconciler: agentSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};

/** Wire Pi into core registries. Call once from `main.ts` on plugin load. */
export function bootstrapPiAgent(): void {
  AgentServices.bootstrap(piAgentRegistration);
  AgentWorkspace.install(piWorkspaceRegistration);
}
