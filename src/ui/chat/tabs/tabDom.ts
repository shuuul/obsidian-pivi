import type { App } from "obsidian";

import { RichChatInput } from "../ui/RichChatInput";
import type { TabDOMElements } from "./types";

/**
 * Builds the DOM structure for a tab.
 */
export function buildTabDOM(
  contentEl: HTMLElement,
  app: App,
): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({
    cls: "pivi-messages-wrapper",
  });
  const messagesEl = messagesWrapperEl.createDiv({ cls: "pivi-messages" });
  const statusPanelContainerEl = messagesWrapperEl.createDiv({
    cls: "pivi-status-panel-container",
  });
  const messagesBottomControlsEl = messagesWrapperEl.createDiv({
    cls: "pivi-messages-bottom-controls",
  });
  const welcomeEl = messagesEl.createDiv({ cls: "pivi-welcome" });
  const inputContainerEl = contentEl.createDiv({ cls: "pivi-input-container" });
  const queueIndicatorEl = inputContainerEl.createDiv({
    cls: "pivi-input-queue-row",
  });
  const navRowEl = inputContainerEl.createDiv({
    cls: "pivi-input-nav-row pivi-hidden",
  });
  const inputWrapper = inputContainerEl.createDiv({
    cls: "pivi-input-wrapper",
  });
  const contextRowEl = inputWrapper.createDiv({ cls: "pivi-context-row" });
  const richInput = new RichChatInput(inputWrapper, {
    placeholder: "How can i help you today?",
    getMentionContext: () => ({
      app,
      mcpServerNames: new Set(),
    }),
  });
  richInput.el.setAttr("dir", "auto");

  return {
    contentEl,
    messagesWrapperEl,
    messagesEl,
    messagesBottomControlsEl,
    welcomeEl,
    statusPanelContainerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    richInput,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}