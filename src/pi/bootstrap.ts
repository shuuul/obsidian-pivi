import { AgentServices } from '../core/agent/AgentServices';
import { AgentWorkspace } from '../core/agent/AgentWorkspace';
import type { AgentRegistration } from '../core/agent/types';
import { maybeGetPiWorkspaceServices, piWorkspaceRegistration } from './app/PiWorkspaceServices';
import { PI_RUNTIME_CAPABILITIES } from './capabilities';
import { PiChatRuntime } from './runtime/PiChatRuntime';
import {
  agentSettingsReconciler,
  PiInlineEditService,
  PiSessionHistoryService,
  PiTaskResultInterpreter,
  PiTitleGenerationService,
} from './services';
import { piChatUIConfig } from './ui/PiChatUIConfig';

const piAgentRegistration: AgentRegistration = {
  capabilities: PI_RUNTIME_CAPABILITIES,
  chatUIConfig: piChatUIConfig,
  createInlineEditService: (plugin) => new PiInlineEditService(plugin),
  createRuntime: ({ plugin }) => {
    const services = maybeGetPiWorkspaceServices();
    return new PiChatRuntime(
      plugin,
      services?.mcpServerManager ?? AgentWorkspace.getMcpServerManager(),
      services?.mcpOAuth ?? null,
      services?.providerOAuth ?? null,
    );
  },
  createTitleGenerationService: (plugin) => new PiTitleGenerationService(plugin),
  displayName: 'Pi',
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiSessionHistoryService(),
  settingsReconciler: agentSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};

/** Wire Pi into core registries. Call once from `main.ts` on plugin load. */
export function bootstrapPiAgent(): void {
  AgentServices.bootstrap(piAgentRegistration);
  AgentWorkspace.install(piWorkspaceRegistration);
}
