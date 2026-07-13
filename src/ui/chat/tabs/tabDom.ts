import type { App } from "obsidian";

import { t } from "@/app/i18n";

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
  const welcomePortalEl = messagesWrapperEl.createDiv({ cls: "pivi-react-welcome-slot" });
  const messagesEl = messagesWrapperEl.createDiv({ cls: "pivi-messages" });
  const messagesPortalEl = messagesEl.createDiv({ cls: "pivi-react-messages-slot" });
  const navigationPortalEl = messagesWrapperEl.createDiv({ cls: "pivi-react-navigation-slot" });
  const statusPanelContainerEl = messagesWrapperEl.createDiv({
    cls: "pivi-status-panel-container",
  });
  const todoPortalEl = statusPanelContainerEl.createDiv({ cls: "pivi-react-todo-slot" });
  const messagesBottomControlsEl = messagesWrapperEl.createDiv({
    cls: "pivi-messages-bottom-controls",
  });
  const inputContainerEl = contentEl.createDiv({ cls: "pivi-input-container" });
  const queuePortalEl = inputContainerEl.createDiv({
    cls: "pivi-react-queue-slot",
  });
  const navRowEl = inputContainerEl.createDiv({
    cls: "pivi-input-nav-row pivi-hidden",
  });
  const inputWrapper = inputContainerEl.createDiv({
    cls: "pivi-input-wrapper",
  });
  const contextRowEl = inputWrapper.createDiv({ cls: "pivi-context-row" });
  const richInput = new RichChatInput(inputWrapper, {
    placeholder: t("chat.composer.placeholder"),
    getMentionContext: () => ({
      app,
      mcpServerNames: new Set(),
    }),
  });
  richInput.el.setAttr("dir", "auto");
  const composerPortalEl = inputWrapper.createDiv({ cls: "pivi-react-composer-slot" });

  return {
    contentEl,
    messagesWrapperEl,
    messagesEl,
    messagesPortalEl,
    messagesBottomControlsEl,
    welcomePortalEl,
    todoPortalEl,
    navigationPortalEl,
    queuePortalEl,
    inputContainerEl,
    inputWrapper,
    richInput,
    composerPortalEl,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}