import type { AgentAdaptor } from '../core/agent/types';
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
  createInlineEditService: () => new PiInlineEditService(),
  createInstructionRefineService: () => new PiInstructionRefineService(),
  createRuntime: ({ plugin }) => new PiChatRuntime(plugin),
  createTitleGenerationService: () => new PiTitleGenerationService(),
  displayName: 'Pi',
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiConversationHistoryService(),
  settingsReconciler: piSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};
