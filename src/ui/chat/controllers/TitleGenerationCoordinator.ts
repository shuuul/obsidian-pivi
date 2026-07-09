import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import type { TitleGenerationService } from '@pivi/pivi-agent-core/runtime/auxTypes';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';

import type { PiviChatHost } from '@/app/hostContracts';

import type { ChatState } from '../state/ChatState';
import type { SessionController } from './SessionController';

export interface TitleGenerationCoordinatorDeps {
  plugin: PiviChatHost;
  state: ChatState;
  openSessionController: SessionController;
  getTitleGenerationService: () => TitleGenerationService | null;
  getAgentService: () => PiChatService | null;
  ensureServiceInitialized?: () => Promise<boolean>;
}

export class TitleGenerationCoordinator {
  constructor(private deps: TitleGenerationCoordinatorDeps) {}

  public async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, openSessionController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentOpenSessionId) {
      const agentService = this.deps.getAgentService();
      let sessionFile: string | undefined;
      if (agentService && this.deps.ensureServiceInitialized) {
        try {
          await this.deps.ensureServiceInitialized();
          const built = { updates: agentService.getSessionStateUpdates() };
          sessionFile = built.updates.sessionFile;
        } catch {
          // Fall back to a fresh JSONL session below.
        }
      }
      const openSession = await plugin.createOpenSession({
        sessionId: agentService?.getSessionId() ?? undefined,
        sessionFile,
      });
      state.currentOpenSessionId = openSession.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = resolveUserMessageDisplayText(firstUserMsg);

    // Set immediate fallback title
    const fallbackTitle = openSessionController.generateFallbackTitle(userContent);
    await plugin.renameSession(state.currentOpenSessionId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateSession(state.currentOpenSessionId, { titleGenerationStatus: 'pending' });

    const convId = state.currentOpenSessionId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    void titleService.generateTitle(
      convId,
      userContent,
      async (openSessionId, result) => {
        // Check if openSession still exists and user hasn't manually renamed
        const currentConv = await plugin.getOpenSessionById(openSessionId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameSession(openSessionId, result.title);
          await plugin.updateSession(openSessionId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateSession(openSessionId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateSession(openSessionId, { titleGenerationStatus: undefined });
        }
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }
}
