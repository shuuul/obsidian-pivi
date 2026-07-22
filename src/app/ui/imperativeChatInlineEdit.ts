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
  onAssistantText?: (accumulatedText: string) => void;
  registerCancel?: (cancel: () => void) => void;
}

let inlineEditSettingsOverlayTail = Promise.resolve();

async function acquireInlineEditSettingsOverlay(): Promise<() => void> {
  const previous = inlineEditSettingsOverlayTail;
  let release = (): void => undefined;
  inlineEditSettingsOverlayTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
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
  let cancelled = false;
  let cancelActiveTurn = (): void => undefined;
  params.registerCancel?.(() => {
    cancelled = true;
    cancelActiveTurn();
  });

  const releaseSettingsOverlay = await acquireInlineEditSettingsOverlay();
  if (cancelled) {
    releaseSettingsOverlay();
    return null;
  }

  let tab: Awaited<ReturnType<TabManager['createTab']>>;
  try {
    tab = await manager.createTab(undefined, undefined, {
      activate: false,
      isArchived: true,
      ...(params.model ? { draftModel: params.model } : {}),
      ...(params.draftTitle ? { draftTitle: params.draftTitle } : {}),
    });
  } catch (error) {
    releaseSettingsOverlay();
    imperativeChatLogger.warn('inline edit tab creation failed', error);
    return null;
  }
  const inputController = tab?.controllers.inputController;
  if (!tab || !inputController) {
    releaseSettingsOverlay();
    return null;
  }

  cancelActiveTurn = () => inputController.cancelStreaming();
  if (cancelled) {
    releaseSettingsOverlay();
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

    let lastReportedText = '';
    await inputController.sendMessage({
      content: params.content,
      onAssistantText: params.onAssistantText
        ? (accumulatedText) => {
            if (
              cancelled
              || tab.lifecycleState === 'closing'
              || tab.state.streamGeneration !== generation + 1
              || accumulatedText === lastReportedText
            ) {
              return;
            }
            lastReportedText = accumulatedText;
            params.onAssistantText?.(accumulatedText);
          }
        : undefined,
    });
    if (
      cancelled
      || tab.lifecycleState === 'closing'
      || tab.state.streamGeneration !== generation + 1
    ) {
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
    releaseSettingsOverlay();
  }
}
