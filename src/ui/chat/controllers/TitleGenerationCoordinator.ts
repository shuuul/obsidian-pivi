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
  onTitleChanged?: (title: string) => void;
  /** Blank-tab custom title set via rename before a session exists. */
  getDraftCustomTitle?: () => string | null;
  clearDraftCustomTitle?: () => void;
}

export class TitleGenerationCoordinator {
  constructor(private deps: TitleGenerationCoordinatorDeps) {}

  public async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, openSessionController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    // Capture before session bind: assigning currentOpenSessionId can fire
    // onOpenSessionIdChanged, which may clear draftTitle as a safety net.
    const draft = this.deps.getDraftCustomTitle?.()?.trim() || null;

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

    const currentSession = await plugin.getOpenSessionById(state.currentOpenSessionId);
    if (currentSession?.titleSource === 'custom') {
      // Safety net may already have applied the draft as custom.
      this.deps.clearDraftCustomTitle?.();
      return;
    }

    // Blank-tab draft custom title wins over firstPrompt/AI generation.
    if (draft) {
      await plugin.renameSession(state.currentOpenSessionId, draft, 'custom');
      this.deps.clearDraftCustomTitle?.();
      this.deps.onTitleChanged?.(draft);
      return;
    }

    // Set immediate fallback title
    const fallbackTitle = openSessionController.generateFallbackTitle(userContent);
    await plugin.renameSession(state.currentOpenSessionId, fallbackTitle, 'firstPrompt');
    this.deps.onTitleChanged?.(fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title
      return;
    }

    const convId = state.currentOpenSessionId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    void titleService.generateTitle(
      convId,
      userContent,
      async (openSessionId, result) => {
        // Check if openSession still exists and user hasn't manually renamed
        const currentConv = await plugin.getOpenSessionById(openSessionId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed.
        const userManuallyRenamed = currentConv.titleSource === 'custom'
          || currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameSession(openSessionId, result.title, 'model');
          this.deps.onTitleChanged?.(result.title);
        }
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }
}
