import { tryParseClipboardConfig } from "@pivi/pivi-agent-core/mcp/mcpConfigParser";
import type {
  ManagedMcpServer,
  McpServerConfig,
  McpServerType,
} from "@pivi/pivi-agent-core/mcp/types";
import {
  DEFAULT_MCP_SERVER,
  getMcpServerType,
  supportsMcpOAuth,
} from "@pivi/pivi-agent-core/mcp/types";
import type { App } from "obsidian";
import { Notice, setIcon } from "obsidian";

import type {
  AppMcpOAuth,
  AppMcpServerTester,
  AppMcpStorage,
} from "@/app/hostPlatform";
import { t } from "@/i18n";
import { confirmDelete } from "@/ui/shared/modals/ConfirmModal";

import { McpServerModal } from "./McpServerModal";
import { McpTestModal } from "./McpTestModal";

export interface McpSettingsManagerDeps {
  app: App;
  mcpStorage: AppMcpStorage;
  mcpOAuth?: AppMcpOAuth | null;
  mcpServerTester?: AppMcpServerTester | null;
  broadcastMcpReload: () => Promise<void>;
}

export class McpSettingsManager {
  private app: App;
  private containerEl: HTMLElement;
  private mcpStorage: AppMcpStorage;
  private mcpOAuth: AppMcpOAuth | null;
  private mcpServerTester: AppMcpServerTester | null;
  private broadcastMcpReload: () => Promise<void>;
  private servers: ManagedMcpServer[] = [];
  private activeAddDropdown: HTMLElement | null = null;
  private readonly ownerDocument: Document;
  private disposed = false;
  private readonly handleDocumentClick = (): void => {
    this.activeAddDropdown?.removeClass("is-visible");
  };

  constructor(containerEl: HTMLElement, deps: McpSettingsManagerDeps) {
    this.app = deps.app;
    this.containerEl = containerEl;
    this.mcpStorage = deps.mcpStorage;
    this.mcpOAuth = deps.mcpOAuth ?? null;
    this.mcpServerTester = deps.mcpServerTester ?? null;
    this.broadcastMcpReload = deps.broadcastMcpReload;
    this.ownerDocument = containerEl.ownerDocument;
    this.ownerDocument.addEventListener("click", this.handleDocumentClick);
    void this.loadAndRender();
  }

  dispose(): void {
    this.disposed = true;
    this.ownerDocument.removeEventListener("click", this.handleDocumentClick);
    this.activeAddDropdown = null;
  }

  private async loadAndRender() {
    this.servers = await this.mcpStorage.load();
    if (this.disposed) {
      return;
    }
    this.render();
  }

  private render() {
    if (this.disposed) {
      return;
    }
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: "pivi-mcp-header" });
    headerEl.createSpan({ text: t("settings.mcp.heading"), cls: "pivi-mcp-label" });

    const addContainer = headerEl.createDiv({ cls: "pivi-mcp-add-container" });
    const addBtn = addContainer.createEl("button", {
      cls: "pivi-settings-action-btn",
      attr: { "aria-label": t("settings.mcp.add") },
    });
    setIcon(addBtn, "plus");

    const dropdown = addContainer.createDiv({ cls: "pivi-mcp-add-dropdown" });
    this.activeAddDropdown = dropdown;

    const stdioOption = dropdown.createDiv({ cls: "pivi-mcp-add-option" });
    setIcon(
      stdioOption.createSpan({ cls: "pivi-mcp-add-option-icon" }),
      "terminal",
    );
    stdioOption.createSpan({ text: t("settings.mcp.typeStdio") });
    stdioOption.addEventListener("click", () => {
      dropdown.removeClass("is-visible");
      this.openModal(null, "stdio");
    });

    const httpOption = dropdown.createDiv({ cls: "pivi-mcp-add-option" });
    setIcon(
      httpOption.createSpan({ cls: "pivi-mcp-add-option-icon" }),
      "globe",
    );
    httpOption.createSpan({ text: t("settings.mcp.typeHttp") });
    httpOption.addEventListener("click", () => {
      dropdown.removeClass("is-visible");
      this.openModal(null, "http");
    });

    const importOption = dropdown.createDiv({ cls: "pivi-mcp-add-option" });
    setIcon(
      importOption.createSpan({ cls: "pivi-mcp-add-option-icon" }),
      "clipboard-paste",
    );
    importOption.createSpan({ text: t("settings.mcp.importClipboard") });
    importOption.addEventListener("click", () => {
      dropdown.removeClass("is-visible");
      void this.importFromClipboard();
    });

    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.toggleClass("is-visible", !dropdown.hasClass("is-visible"));
    });

    if (this.servers.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: "pivi-mcp-empty" });
      emptyEl.setText(t("settings.mcp.empty"));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: "pivi-mcp-list" });
    for (const server of this.servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: "pivi-mcp-item" });
    if (!server.enabled) {
      itemEl.addClass("pivi-mcp-item-disabled");
    }

    const statusEl = itemEl.createDiv({ cls: "pivi-mcp-status" });
    statusEl.addClass(
      server.enabled ? "pivi-mcp-status-enabled" : "pivi-mcp-status-disabled",
    );

    const infoEl = itemEl.createDiv({ cls: "pivi-mcp-info" });

    const nameRow = infoEl.createDiv({ cls: "pivi-mcp-name-row" });

    const nameEl = nameRow.createSpan({ cls: "pivi-mcp-name" });
    nameEl.setText(server.name);

    const serverType = getMcpServerType(server.config);
    const typeEl = nameRow.createSpan({ cls: "pivi-mcp-type-badge" });
    typeEl.setText(serverType);

    if (server.contextSaving) {
      const csEl = nameRow.createSpan({ cls: "pivi-mcp-context-saving-badge" });
      csEl.setText("@");
      csEl.setAttribute(
        "title",
        t("settings.mcp.contextSavingTitle", { name: server.name }),
      );
    }

    const previewEl = infoEl.createDiv({ cls: "pivi-mcp-preview" });
    if (server.description) {
      previewEl.setText(server.description);
    } else {
      previewEl.setText(this.getServerPreview(server, serverType));
    }

    if (supportsMcpOAuth(server) && this.mcpOAuth) {
      void this.mcpOAuth.getAuthStatus(server).then((status) => {
        if (status === "authenticated") {
          const badge = nameRow.createSpan({ cls: "pivi-mcp-type-badge" });
          badge.setText(t("settings.mcp.oauthBadge"));
          badge.setAttribute("title", t("settings.mcp.oauthAuthenticated"));
        } else if (status === "expired") {
          const badge = nameRow.createSpan({ cls: "pivi-mcp-type-badge" });
          badge.setText(t("settings.mcp.oauthExpiredBadge"));
          badge.setAttribute("title", t("settings.mcp.oauthExpiredTitle"));
        }
      });
    }

    const actionsEl = itemEl.createDiv({ cls: "pivi-mcp-actions" });

    if (supportsMcpOAuth(server) && this.mcpOAuth) {
      const authBtn = actionsEl.createEl("button", {
        cls: "pivi-mcp-action-btn",
        attr: { "aria-label": t("settings.mcp.authOauth") },
      });
      setIcon(authBtn, "key");
      authBtn.addEventListener("click", () => {
        void this.authenticateServer(server);
      });

      const logoutBtn = actionsEl.createEl("button", {
        cls: "pivi-mcp-action-btn",
        attr: { "aria-label": t("settings.mcp.clearOauth") },
      });
      setIcon(logoutBtn, "log-out");
      logoutBtn.addEventListener("click", () => {
        void this.logoutServer(server);
      });
    }

    const testBtn = actionsEl.createEl("button", {
      cls: "pivi-mcp-action-btn",
      attr: { "aria-label": t("settings.mcp.verifyTools") },
    });
    setIcon(testBtn, "zap");
    testBtn.addEventListener("click", () => {
      void this.testServer(server);
    });

    const toggleBtn = actionsEl.createEl("button", {
      cls: "pivi-mcp-action-btn",
      attr: {
        "aria-label": server.enabled ? t("common.disable") : t("common.enable"),
      },
    });
    setIcon(toggleBtn, server.enabled ? "toggle-right" : "toggle-left");
    toggleBtn.addEventListener("click", () => {
      void this.toggleServer(server);
    });

    const editBtn = actionsEl.createEl("button", {
      cls: "pivi-mcp-action-btn",
      attr: { "aria-label": t("common.edit") },
    });
    setIcon(editBtn, "pencil");
    editBtn.addEventListener("click", () => this.openModal(server));

    const deleteBtn = actionsEl.createEl("button", {
      cls: "pivi-mcp-action-btn pivi-mcp-delete-btn",
      attr: { "aria-label": t("common.delete") },
    });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => {
      void this.deleteServer(server);
    });
  }

  private async testServer(server: ManagedMcpServer) {
    const modal = new McpTestModal(
      this.app,
      server.name,
      server.disabledTools,
      async (toolName, enabled) => {
        await this.updateDisabledTool(server, toolName, enabled);
      },
      async (disabledTools) => {
        await this.updateAllDisabledTools(server, disabledTools);
      },
    );
    modal.open();

    try {
      if (!this.mcpServerTester) {
        modal.setError(t("settings.mcp.verifyUnavailable"));
        return;
      }
      const result = await this.mcpServerTester.testServer(server);
      modal.setResult(result);
    } catch (error) {
      modal.setError(
        error instanceof Error ? error.message : t("settings.mcp.verifyFailed"),
      );
    }
  }

  /** Rolls back on save failure; warns on reload failure (since save succeeded). */
  private async updateServerDisabledTools(
    server: ManagedMcpServer,
    newDisabledTools: string[] | undefined,
  ): Promise<void> {
    const previous = server.disabledTools
      ? [...server.disabledTools]
      : undefined;
    server.disabledTools = newDisabledTools;

    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      server.disabledTools = previous;
      throw error;
    }

    try {
      await this.broadcastMcpReload();
    } catch {
      // Save succeeded but reload failed - don't rollback since disk has correct state
      new Notice(t("settings.mcp.saveReloadFailed"));
    }
  }

  private async updateDisabledTool(
    server: ManagedMcpServer,
    toolName: string,
    enabled: boolean,
  ) {
    const disabledTools = new Set(server.disabledTools ?? []);
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await this.updateServerDisabledTools(
      server,
      disabledTools.size > 0 ? Array.from(disabledTools) : undefined,
    );
  }

  private async updateAllDisabledTools(
    server: ManagedMcpServer,
    disabledTools: string[],
  ) {
    await this.updateServerDisabledTools(
      server,
      disabledTools.length > 0 ? disabledTools : undefined,
    );
  }

  private getServerPreview(
    server: ManagedMcpServer,
    type: McpServerType,
  ): string {
    if (type === "stdio") {
      const config = server.config as { command: string; args?: string[] };
      const args = config.args?.join(" ") || "";
      return args ? `${config.command} ${args}` : config.command;
    } else {
      const config = server.config as { url: string };
      return config.url;
    }
  }

  private openModal(
    existing: ManagedMcpServer | null,
    initialType?: McpServerType,
  ) {
    const modal = new McpServerModal(
      this.app,
      existing,
      (server) => {
        void this.saveServer(server, existing).catch((error: unknown) => {
          new Notice(
            error instanceof Error
              ? error.message
              : t("settings.mcp.saveFailed"),
          );
        });
      },
      initialType,
    );
    modal.open();
  }

  private async importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        new Notice(t("settings.mcp.clipboardEmpty"));
        return;
      }

      const parsed = tryParseClipboardConfig(text);
      if (!parsed || parsed.servers.length === 0) {
        new Notice(t("settings.mcp.noValidConfig"));
        return;
      }

      if (parsed.needsName || parsed.servers.length === 1) {
        const server = parsed.servers[0];
        const type = getMcpServerType(server.config);
        const modal = new McpServerModal(
          this.app,
          null,
          (savedServer) => {
            void this.saveServer(savedServer, null).catch((error: unknown) => {
              new Notice(
                error instanceof Error
                  ? error.message
                  : t("settings.mcp.saveFailed"),
              );
            });
          },
          type,
          server, // Pre-fill with parsed config
        );
        modal.open();
        if (parsed.needsName) {
          new Notice(t("settings.mcp.enterName"));
        }
        return;
      }

      await this.importServers(parsed.servers);
    } catch {
      new Notice(t("settings.mcp.clipboardReadFailed"));
    }
  }

  private async saveServer(
    server: ManagedMcpServer,
    existing: ManagedMcpServer | null,
  ) {
    if (existing) {
      const index = this.servers.findIndex((s) => s.name === existing.name);
      if (index !== -1) {
        if (server.name !== existing.name) {
          const conflict = this.servers.find((s) => s.name === server.name);
          if (conflict) {
            new Notice(t("settings.mcp.alreadyExists", { name: server.name }));
            return;
          }
        }
        this.servers[index] = server;
      }
    } else {
      const conflict = this.servers.find((s) => s.name === server.name);
      if (conflict) {
        new Notice(t("settings.mcp.alreadyExists", { name: server.name }));
        return;
      }
      this.servers.push(server);
    }

    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(
      existing
        ? t("settings.mcp.serverUpdated", { name: server.name })
        : t("settings.mcp.serverAdded", { name: server.name }),
    );
  }

  private async importServers(
    servers: Array<{ name: string; config: McpServerConfig }>,
  ) {
    const added: string[] = [];
    const skipped: string[] = [];

    for (const server of servers) {
      const name = server.name.trim();
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
        skipped.push(server.name || "<unnamed>");
        continue;
      }

      const conflict = this.servers.find((s) => s.name === name);
      if (conflict) {
        skipped.push(name);
        continue;
      }

      this.servers.push({
        name,
        config: server.config,
        enabled: DEFAULT_MCP_SERVER.enabled,
        contextSaving: DEFAULT_MCP_SERVER.contextSaving,
      });
      added.push(name);
    }

    if (added.length === 0) {
      new Notice(t("settings.mcp.importedNone"));
      return;
    }

    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();

    if (skipped.length > 0) {
      new Notice(
        t("settings.mcp.importedWithSkipped", {
          count: added.length,
          skipped: skipped.length,
        }),
      );
    } else {
      new Notice(t("settings.mcp.imported", { count: added.length }));
    }
  }

  private async authenticateServer(server: ManagedMcpServer) {
    if (!this.mcpOAuth) {
      return;
    }
    new Notice(t("settings.mcp.authenticating", { name: server.name }));
    try {
      const status = await this.mcpOAuth.authenticate(server);
      if (status === "authenticated") {
        new Notice(t("settings.mcp.authenticated", { name: server.name }));
        await this.broadcastMcpReload();
        this.render();
      } else {
        new Notice(
          t("settings.mcp.authStatus", { name: server.name, status }),
        );
      }
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : t("settings.mcp.authFailed", { name: server.name }),
      );
    }
  }

  private async logoutServer(server: ManagedMcpServer) {
    if (!this.mcpOAuth) {
      return;
    }
    await this.mcpOAuth.logout(server.name);
    await this.broadcastMcpReload();
    this.render();
    new Notice(t("settings.mcp.oauthCleared", { name: server.name }));
  }

  private async toggleServer(server: ManagedMcpServer) {
    server.enabled = !server.enabled;
    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(
      server.enabled
        ? t("settings.mcp.serverEnabled", { name: server.name })
        : t("settings.mcp.serverDisabled", { name: server.name }),
    );
  }

  private async deleteServer(server: ManagedMcpServer) {
    if (
      !(await confirmDelete(
        this.app,
        t("settings.mcp.deleteConfirm", { name: server.name }),
      ))
    ) {
      return;
    }

    this.servers = this.servers.filter((s) => s.name !== server.name);
    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(t("settings.mcp.serverDeleted", { name: server.name }));
  }

  /** Refresh the server list (call after external changes). */
  public refresh() {
    void this.loadAndRender();
  }
}
