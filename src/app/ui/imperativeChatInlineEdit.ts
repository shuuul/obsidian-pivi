import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';

import { imperativeChatLogger } from '@/app/ui/imperativeChatTabAction';
import { extractAssistantTextFromMessages } from '@/app/ui/inlineEditHelpers';
import { updateTabAgentSettings } from '@/ui/chat/tabs/tabAgentContext';
import type { TabManager } from '@/ui/chat/tabs/TabManager';

export interface SubmitInlineEditTurnParams {
  content: string;
  model?: string;
  thinkingLevel?: string;
  draftTitle?: string;
}

async function waitForTabStreamingComplete(
  ownerWindow: Window,
  isStreaming: () => boolean,
  isCancelled: () => boolean,
): Promise<boolean> {
  const deadline = ownerWindow.performance.now() + 10 * 60 * 1000;
  while (isStreaming()) {
    if (isCancelled()) {
      return false;
    }
    if (ownerWindow.performance.now() >= deadline) {
      throw new Error('Timed out waiting for inline edit streaming to complete.');
    }
    await new Promise(resolve => ownerWindow.setTimeout(resolve, 50));
  }
  return true;
}

/**
 * Runs one inline-edit turn on a newly created archived tab.
 * Model selection uses draftModel; thinking-level temporarily overlays shared
 * settings and is restored afterward so the active composer is not left changed.
 */
export async function submitInlineEditTurn(
  manager: TabManager,
  ports: ChatPorts,
  params: SubmitInlineEditTurnParams,
): Promise<{ assistantText: string; tabId: string } | null> {
  const tab = await manager.createTab(undefined, undefined, {
    activate: false,
    isArchived: true,
    ...(params.model ? { draftModel: params.model } : {}),
    ...(params.draftTitle ? { draftTitle: params.draftTitle } : {}),
  });
  const inputController = tab?.controllers.inputController;
  const ownerWindow = tab?.dom.messagesEl.ownerDocument.defaultView;
  if (!tab || !inputController || !ownerWindow) {
    return null;
  }

  const generation = tab.state.streamGeneration;
  const previousSnapshot = ports.settings.getSettingsSnapshot();
  const previousModel = previousSnapshot.model;
  const previousThinkingLevel = previousSnapshot.thinkingLevel;
  const shouldOverlaySettings = Boolean(params.model || params.thinkingLevel);

  try {
    if (shouldOverlaySettings) {
      await updateTabAgentSettings(ports, (settings) => {
        if (params.model) {
          settings.model = params.model;
          ports.models.applyModelDefaults(params.model, settings);
        }
        if (params.thinkingLevel) {
          settings.thinkingLevel = params.thinkingLevel;
          ports.models.applyReasoningSelection?.(
            params.model ?? settings.model,
            params.thinkingLevel,
            settings,
          );
        }
      });
    }

    await inputController.sendMessage({ content: params.content });
    const completed = await waitForTabStreamingComplete(
      ownerWindow,
      () => tab.state.isStreaming,
      () => tab.lifecycleState === 'closing' || tab.state.streamGeneration !== generation,
    );
    if (!completed) {
      return null;
    }

    return {
      assistantText: extractAssistantTextFromMessages(tab.state.messages),
      tabId: tab.id,
    };
  } catch (error) {
    imperativeChatLogger.warn('inline edit turn failed', error);
    return null;
  } finally {
    if (shouldOverlaySettings) {
      try {
        await updateTabAgentSettings(ports, (settings) => {
          settings.model = previousModel;
          ports.models.applyModelDefaults(previousModel, settings);
          settings.thinkingLevel = previousThinkingLevel;
          ports.models.applyReasoningSelection?.(
            previousModel,
            previousThinkingLevel,
            settings,
          );
        });
      } catch (restoreError) {
        imperativeChatLogger.warn('failed to restore settings after inline edit', restoreError);
      }
    }
  }
}
