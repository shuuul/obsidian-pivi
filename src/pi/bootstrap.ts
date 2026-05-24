import { PiAgentServices } from '../core/agent/PiAgentServices';
import { AgentWorkspace } from '../core/agent/AgentWorkspace';
import type { PiAgentRegistration } from '../core/agent/types';
import { maybeGetPiWorkspaceServices, piWorkspaceRegistration } from './app/PiWorkspaceServices';
import { PI_RUNTIME_CAPABILITIES } from './capabilities';
import { PiChatRuntime } from './runtime/PiChatRuntime';
import {
  PiConversationHistoryService,
  PiInlineEditService,
  PiInstructionRefineService,
  agentSettingsReconciler,
  PiTaskResultInterpreter,
  PiTitleGenerationService,
} from './services';
import { piChatUIConfig } from './ui/PiChatUIConfig';

const piAgentRegistration: PiAgentRegistration = {
  capabilities: PI_RUNTIME_CAPABILITIES,
  chatUIConfig: piChatUIConfig,
  createInlineEditService: (plugin) => new PiInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new PiInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => {
    const services = maybeGetPiWorkspaceServices();
    return new PiChatRuntime(
      plugin,
      services?.mcpServerManager ?? AgentWorkspace.getMcpServerManager(),
      services?.mcpOAuth ?? null,
    );
  },
  createTitleGenerationService: (plugin) => new PiTitleGenerationService(plugin),
  displayName: 'Pi',
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiConversationHistoryService(),
  settingsReconciler: agentSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};

/** Wire Pi into core registries. Call once from `main.ts` on plugin load. */
export function bootstrapPiAgent(): void {
  PiAgentServices.bootstrap(piAgentRegistration);
  AgentWorkspace.install(piWorkspaceRegistration);
}
