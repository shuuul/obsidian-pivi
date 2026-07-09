import type { McpTestResult, McpTool } from "@pivi/pivi-agent-core/mcp/types";
import type { App } from "obsidian";
import { Modal, Notice, setIcon } from "obsidian";

import { t } from "@/i18n";

function formatToggleError(error: unknown): string {
  if (!(error instanceof Error)) return t("settings.mcp.test.toggleFailed");

  const msg = error.message.toLowerCase();
  if (msg.includes("permission") || msg.includes("eacces")) {
    return t("settings.mcp.test.permissionDenied");
  }
  if (
    msg.includes("enospc") ||
    msg.includes("disk full") ||
    msg.includes("no space")
  ) {
    return t("settings.mcp.test.diskFull");
  }
  if (msg.includes("json") || msg.includes("syntax")) {
    return t("settings.mcp.test.configCorrupted");
  }
  return error.message || t("settings.mcp.test.toggleFailed");
}

const SVG_NS = "http://www.w3.org/2000/svg";

function appendSpinnerSvg(container: HTMLElement): void {
  const svg = container.ownerDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");

  const path = container.ownerDocument.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  );
  svg.appendChild(path);

  container.appendChild(svg);
}

export class McpTestModal extends Modal {
  private serverName: string;
  private result: McpTestResult | null = null;
  private loading = true;
  private contentEl_: HTMLElement | null = null;
  private disabledTools: Set<string>;
  private onToolToggle?: (toolName: string, enabled: boolean) => Promise<void>;
  private onBulkToggle?: (disabledTools: string[]) => Promise<void>;
  private toolToggles: Map<
    string,
    { checkbox: HTMLInputElement; container: HTMLElement }
  > = new Map();
  private toolElements: Map<string, HTMLElement> = new Map();
  private toggleAllBtn: HTMLButtonElement | null = null;
  private pendingToggle = false;

  constructor(
    app: App,
    serverName: string,
    initialDisabledTools?: string[],
    onToolToggle?: (toolName: string, enabled: boolean) => Promise<void>,
    onBulkToggle?: (disabledTools: string[]) => Promise<void>,
  ) {
    super(app);
    this.serverName = serverName;
    this.disabledTools = new Set(
      (initialDisabledTools ?? [])
        .map((tool) => tool.trim())
        .filter((tool) => tool.length > 0),
    );
    this.onToolToggle = onToolToggle;
    this.onBulkToggle = onBulkToggle;
  }

  onOpen() {
    this.setTitle(t("settings.mcp.test.titleVerify", { name: this.serverName }));
    this.modalEl.addClass("pivi-mcp-test-modal");
    this.contentEl_ = this.contentEl;
    this.renderLoading();
  }

  setResult(result: McpTestResult) {
    this.result = result;
    this.loading = false;
    this.render();
  }

  setError(error: string) {
    this.result = { success: false, tools: [], error };
    this.loading = false;
    this.render();
  }

  private renderLoading() {
    if (!this.contentEl_) return;
    this.contentEl_.empty();

    const loadingEl = this.contentEl_.createDiv({
      cls: "pivi-mcp-test-loading",
    });

    const spinnerEl = loadingEl.createDiv({ cls: "pivi-mcp-test-spinner" });
    appendSpinnerSvg(spinnerEl);

    loadingEl.createSpan({ text: t("settings.mcp.test.connecting") });
  }

  private render() {
    if (!this.contentEl_) return;
    this.contentEl_.empty();

    if (!this.result) {
      this.renderLoading();
      return;
    }

    const statusEl = this.contentEl_.createDiv({ cls: "pivi-mcp-test-status" });

    const iconEl = statusEl.createSpan({ cls: "pivi-mcp-test-icon" });
    if (this.result.success) {
      setIcon(iconEl, "check-circle");
      iconEl.addClass("success");
    } else {
      setIcon(iconEl, "x-circle");
      iconEl.addClass("error");
    }

    const textEl = statusEl.createSpan({ cls: "pivi-mcp-test-text" });
    if (this.result.success) {
      if (this.result.serverName) {
        textEl.setText(
          this.result.serverVersion
            ? t("settings.mcp.test.connectedToVersion", {
                name: this.result.serverName,
                version: this.result.serverVersion,
              })
            : t("settings.mcp.test.connectedTo", {
                name: this.result.serverName,
              }),
        );
      } else {
        textEl.setText(t("settings.mcp.test.connected"));
      }
    } else {
      textEl.setText(t("settings.mcp.test.failed"));
    }

    if (this.result.error) {
      const errorEl = this.contentEl_.createDiv({ cls: "pivi-mcp-test-error" });
      errorEl.setText(this.result.error);
    }

    this.toolToggles.clear();
    this.toolElements.clear();

    if (this.result.tools.length > 0) {
      const toolsSection = this.contentEl_.createDiv({
        cls: "pivi-mcp-test-tools",
      });

      const toolsHeader = toolsSection.createDiv({
        cls: "pivi-mcp-test-tools-header",
      });
      toolsHeader.setText(
        t("settings.mcp.test.availableTools", {
          count: this.result.tools.length,
        }),
      );

      const toolsList = toolsSection.createDiv({
        cls: "pivi-mcp-test-tools-list",
      });

      for (const tool of this.result.tools) {
        this.renderTool(toolsList, tool);
      }
    } else if (this.result.success) {
      const noToolsEl = this.contentEl_.createDiv({
        cls: "pivi-mcp-test-no-tools",
      });
      noToolsEl.setText(t("settings.mcp.test.noTools"));
    }

    const buttonContainer = this.contentEl_.createDiv({
      cls: "pivi-mcp-test-buttons",
    });

    if (this.result.tools.length > 0 && this.onToolToggle) {
      this.toggleAllBtn = buttonContainer.createEl("button", {
        cls: "pivi-mcp-toggle-all-btn",
      });
      this.updateToggleAllButton();
      this.toggleAllBtn.addEventListener("click", () => {
        void this.handleToggleAll();
      });
    }

    const closeBtn = buttonContainer.createEl("button", {
      text: t("common.close"),
      cls: "mod-cta",
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  private renderTool(container: HTMLElement, tool: McpTool) {
    const toolEl = container.createDiv({ cls: "pivi-mcp-test-tool" });

    const headerEl = toolEl.createDiv({ cls: "pivi-mcp-test-tool-header" });

    const iconEl = headerEl.createSpan({ cls: "pivi-mcp-test-tool-icon" });
    setIcon(iconEl, "wrench");

    const nameEl = headerEl.createSpan({ cls: "pivi-mcp-test-tool-name" });
    nameEl.setText(tool.name);

    const toggleEl = headerEl.createDiv({ cls: "pivi-mcp-test-tool-toggle" });
    const toggleContainer = toggleEl.createDiv({ cls: "checkbox-container" });
    const checkbox = toggleContainer.createEl("input", {
      type: "checkbox",
      attr: { tabindex: "0" },
    });

    const isEnabled = !this.disabledTools.has(tool.name);
    checkbox.checked = isEnabled;
    toggleContainer.toggleClass("is-enabled", isEnabled);
    this.updateToolState(toolEl, isEnabled);

    this.toolToggles.set(tool.name, { checkbox, container: toggleContainer });
    this.toolElements.set(tool.name, toolEl);

    if (!this.onToolToggle) {
      checkbox.disabled = true;
    } else {
      // Click on container instead of checkbox change event for cross-browser reliability
      toggleContainer.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        void this.handleToolToggle(tool.name, checkbox, toggleContainer);
      });
    }

    if (tool.description) {
      const descEl = toolEl.createDiv({ cls: "pivi-mcp-test-tool-desc" });
      descEl.setText(tool.description);
    }
  }

  private async handleToolToggle(
    toolName: string,
    checkbox: HTMLInputElement,
    container: HTMLElement,
  ) {
    const toolEl = this.toolElements.get(toolName);
    if (!toolEl) return;

    const wasDisabled = this.disabledTools.has(toolName);
    const nextDisabled = !checkbox.checked;

    if (nextDisabled) {
      this.disabledTools.add(toolName);
    } else {
      this.disabledTools.delete(toolName);
    }

    container.toggleClass("is-enabled", !nextDisabled);
    this.updateToolState(toolEl, !nextDisabled);
    this.updateToggleAllButton();
    checkbox.disabled = true;

    try {
      await this.onToolToggle?.(toolName, !nextDisabled);
    } catch (error) {
      // Rollback
      if (nextDisabled) {
        this.disabledTools.delete(toolName);
      } else {
        this.disabledTools.add(toolName);
      }
      checkbox.checked = !wasDisabled;
      container.toggleClass("is-enabled", !wasDisabled);
      this.updateToolState(toolEl, !wasDisabled);
      this.updateToggleAllButton();
      new Notice(formatToggleError(error));
    } finally {
      checkbox.disabled = false;
    }
  }

  private updateToolState(toolEl: HTMLElement, enabled: boolean) {
    toolEl.toggleClass("pivi-mcp-test-tool-disabled", !enabled);
  }

  private updateToggleAllButton() {
    if (!this.toggleAllBtn || !this.result) return;

    const allEnabled = this.disabledTools.size === 0;

    if (allEnabled) {
      this.toggleAllBtn.setText(t("settings.mcp.test.disableAll"));
      this.toggleAllBtn.toggleClass("is-destructive", true);
    } else {
      this.toggleAllBtn.setText(t("settings.mcp.test.enableAll"));
      this.toggleAllBtn.toggleClass("is-destructive", false);
    }
  }

  private async handleToggleAll() {
    if (!this.result || this.pendingToggle || !this.onBulkToggle) return;

    const allEnabled = this.disabledTools.size === 0;
    const previousDisabled = new Set(this.disabledTools);

    const newDisabledTools: string[] = allEnabled
      ? this.result.tools.map((tool) => tool.name) // Disable all
      : []; // Enable all

    this.pendingToggle = true;
    if (this.toggleAllBtn) this.toggleAllBtn.disabled = true;

    for (const { checkbox } of this.toolToggles.values()) {
      checkbox.disabled = true;
    }

    // Optimistic UI update
    this.disabledTools = new Set(newDisabledTools);
    for (const tool of this.result.tools) {
      const toggle = this.toolToggles.get(tool.name);
      const toolEl = this.toolElements.get(tool.name);
      if (!toggle || !toolEl) continue;

      const isEnabled = !this.disabledTools.has(tool.name);
      toggle.checkbox.checked = isEnabled;
      toggle.container.toggleClass("is-enabled", isEnabled);
      this.updateToolState(toolEl, isEnabled);
    }
    this.updateToggleAllButton();

    try {
      await this.onBulkToggle(newDisabledTools);
    } catch (error) {
      this.disabledTools = previousDisabled;
      for (const tool of this.result.tools) {
        const toggle = this.toolToggles.get(tool.name);
        const toolEl = this.toolElements.get(tool.name);
        if (!toggle || !toolEl) continue;

        const isEnabled = !this.disabledTools.has(tool.name);
        toggle.checkbox.checked = isEnabled;
        toggle.container.toggleClass("is-enabled", isEnabled);
        this.updateToolState(toolEl, isEnabled);
      }
      this.updateToggleAllButton();
      new Notice(formatToggleError(error));
    }

    for (const { checkbox } of this.toolToggles.values()) {
      checkbox.disabled = false;
    }

    this.pendingToggle = false;
    if (this.toggleAllBtn) this.toggleAllBtn.disabled = false;
  }

  onClose() {
    this.contentEl.empty();
  }
}
