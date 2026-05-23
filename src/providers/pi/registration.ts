import type { ProviderRegistration } from '../../core/providers/types';
import { PiInlineEditService } from './auxiliary/PiInlineEditService';
import { PiInstructionRefineService } from './auxiliary/PiInstructionRefineService';
import { PiTaskResultInterpreter } from './auxiliary/PiTaskResultInterpreter';
import { PiTitleGenerationService } from './auxiliary/PiTitleGenerationService';
import { PI_PROVIDER_CAPABILITIES } from './capabilities';
import { piSettingsReconciler } from './env/PiSettingsReconciler';
import { PiConversationHistoryService } from './history/PiConversationHistoryService';
import { PiChatRuntime } from './runtime/PiChatRuntime';
import { piChatUIConfig } from './ui/PiChatUIConfig';

export const piProviderRegistration: ProviderRegistration = {
  capabilities: PI_PROVIDER_CAPABILITIES,
  chatUIConfig: piChatUIConfig,
  createInlineEditService: (plugin) => new PiInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new PiInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new PiChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new PiTitleGenerationService(plugin),
  displayName: 'Pi',
  environmentKeyPatterns: [/^PI_/i],
  historyService: new PiConversationHistoryService(),
  isEnabled: () => true,
  settingsReconciler: piSettingsReconciler,
  taskResultInterpreter: new PiTaskResultInterpreter(),
};
