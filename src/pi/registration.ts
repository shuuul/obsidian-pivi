import { AgentWorkspace } from '../core/agent/AgentWorkspace';
import type { AgentAdaptor } from '../core/agent/types';
import { maybeGetPiWorkspaceServices } from './app/PiWorkspaceServices';
import { PI_RUNTIME_CAPABILITIES } from './capabilities';
import { PiChatRuntime } from './runtime/PiChatRuntime';
import {
  PiConversationHistoryService,
  PiInlineEditService,
  PiInstructionRefineService,
  piSettingsReconciler,
  PiTaskResultInterpreter,
  PiTitleGenerationService,
} from './services';
import { piChatUIConfig } from './ui/PiChatUIConfig';

export const piAgentAdaptor: AgentAdaptor = {
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
  settingsReconciler: piSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};
