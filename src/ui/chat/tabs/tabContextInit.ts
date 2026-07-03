import type PiviPlugin from "@/app/PiviPluginHost";

import { FileContextManager } from "../ui/FileContext";
import { ImageContextManager } from "../ui/ImageContext";
import { autoResizeTextarea } from "../ui/textareaResize";
import type { TabData } from "./types";

export function initializeContextManagers(
  tab: TabData,
  plugin: PiviPlugin,
): void {
  const { dom } = tab;
  const app = plugin.app;

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.richInput,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      getExternalContexts: () =>
        tab.ui.externalContextSelector?.getExternalContexts() || [],
      getSkillNames: () =>
        new Set(
          plugin.getPiWorkspace()?.skillProvider.listSkills().map((skill) => skill.name) ?? [],
        ),
    },
    dom.inputContainerEl,
  );
  tab.ui.fileContextManager.setMcpManager(
    plugin.getPiWorkspace()?.mcpServerManager ?? null,
  );
  dom.richInput.setMentionContextGetter(() =>
    tab.ui.fileContextManager!.buildMentionBadgeContext(),
  );

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.richInput,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.renderer?.scrollToBottomIfNeeded();
      },
    },
    dom.contextRowEl,
  );
}