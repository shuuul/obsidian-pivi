import type { PiviChatHost } from "@/app/hostContracts";
import { getActiveWindow } from "@/ui/shared/dom";

import { autoResizeTextarea } from "../ui/textareaResize";
import { shouldSendMessageFromEnterKey } from "./tabAgentContext";
import type { TabData } from "./types";

/**
 * Wires up input event handlers for a tab.
 * Call this after controllers are initialized.
 * Stores cleanup functions in dom.eventCleanups for proper memory management.
 */
export function wireTabInputEvents(tab: TabData, plugin: PiviChatHost): void {
  const { dom, ui, state, controllers } = tab;

  const keydownHandler = (e: KeyboardEvent) => {
    if (ui.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (ui.fileContextManager?.handleMentionKeydown(e)) {
      return;
    }

    if (e.key === "Escape" && !e.isComposing && state.isStreaming) {
      e.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }

    if (shouldSendMessageFromEnterKey(e, plugin.settings)) {
      e.preventDefault();
      void controllers.inputController?.sendMessage();
    }
  };
  const pasteHandler = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i]?.type.startsWith("image/")) {
          return;
        }
      }
    }
    dom.richInput.handlePaste(e);
  };
  dom.richInput.el.addEventListener("paste", pasteHandler);
  dom.eventCleanups.push(() =>
    dom.richInput.el.removeEventListener("paste", pasteHandler),
  );

  dom.richInput.addEventListener("keydown", keydownHandler as EventListener);
  dom.eventCleanups.push(() =>
    dom.richInput.removeEventListener(
      "keydown",
      keydownHandler as EventListener,
    ),
  );

  const inputHandler = () => {
    ui.fileContextManager?.handleInputChange();
    ui.composerActions?.refresh();

    autoResizeTextarea(dom.richInput.el);
  };
  dom.richInput.addEventListener("input", inputHandler);
  dom.eventCleanups.push(() =>
    dom.richInput.removeEventListener("input", inputHandler),
  );

  const focusHandler = (e: FocusEvent) => {
    if (e.relatedTarget && dom.contentEl.contains(e.relatedTarget as Node))
      return;
    controllers.selectionController?.showHighlight();
  };
  dom.contentEl.addEventListener("focusin", focusHandler);
  dom.eventCleanups.push(() =>
    dom.contentEl.removeEventListener("focusin", focusHandler),
  );

  const SCROLL_THRESHOLD = 20;
  const RE_ENABLE_DELAY = 150;
  let reEnableTimeout: number | null = null;

  const isAutoScrollAllowed = (): boolean =>
    plugin.settings.enableAutoScroll ?? true;

  const scrollHandler = () => {
    if (!isAutoScrollAllowed()) {
      if (reEnableTimeout) {
        getActiveWindow(dom.messagesEl).clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom =
      scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
    const scrollWin = getActiveWindow(dom.messagesEl);

    if (!isAtBottom) {
      if (reEnableTimeout) {
        scrollWin.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled) {
      if (!reEnableTimeout) {
        reEnableTimeout = scrollWin.setTimeout(() => {
          reEnableTimeout = null;
          const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
          if (scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD) {
            state.autoScrollEnabled = true;
          }
        }, RE_ENABLE_DELAY);
      }
    }
  };
  dom.messagesEl.addEventListener("scroll", scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.messagesEl.removeEventListener("scroll", scrollHandler);
    if (reEnableTimeout)
      getActiveWindow(dom.messagesEl).clearTimeout(reEnableTimeout);
  });
}
