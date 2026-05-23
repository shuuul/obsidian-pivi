import type { ProviderRegistration } from '../core/agent/types';
import { PI_PROVIDER_CAPABILITIES } from './capabilities';
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

export const piProviderRegistration: ProviderRegistration = {
  capabilities: PI_PROVIDER_CAPABILITIES,
  chatUIConfig: piChatUIConfig,
  createInlineEditService: () => new PiInlineEditService(),
  createInstructionRefineService: () => new PiInstructionRefineService(),
  createRuntime: ({ plugin }) => new PiChatRuntime(plugin),
  createTitleGenerationService: () => new PiTitleGenerationService(),
  displayName: 'Pi',
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiConversationHistoryService(),
  isEnabled: () => true,
  settingsReconciler: piSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};
