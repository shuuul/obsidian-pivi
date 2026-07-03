import type { McpServerManager } from '@pivi/pivi-agent-core/mcp/mcpServerManager';
import { type ManagedMcpServer, type McpAuthStatus,supportsMcpOAuth } from '@pivi/pivi-agent-core/mcp/types';
import { Notice } from 'obsidian';

import { appendCheckIcon, appendMcpIcon } from '@/ui/shared/utils/icons';

import { runToolbarAction } from './ToolbarTypes';

interface AppMcpOAuth {
  getAuthStatus(server: ManagedMcpServer): Promise<McpAuthStatus>;
  authenticate(server: ManagedMcpServer): Promise<McpAuthStatus>;
  logout(serverName: string): Promise<void>;
}

interface AppMcpServerProbeProvider {
  testServer(serverName: string): Promise<{ toolCount: number }>;
}

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpManager: McpServerManager | null = null;
  private mcpOAuth: AppMcpOAuth | null = null;
  private mcpProbeProvider: AppMcpServerProbeProvider | null = null;
  private openSettingsCallback: (() => void) | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private visible = true;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'pivi-mcp-selector' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.container.addClass('pivi-hidden');
    } else {
      this.updateDisplay();
    }
  }

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) {
      this.enabledServers.clear();
      this.onChangeCallback?.(this.enabledServers);
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setRecoveryActions(options: {
    mcpOAuth?: AppMcpOAuth | null;
    mcpProbeProvider?: AppMcpServerProbeProvider | null;
    openSettings?: (() => void) | null;
  }): void {
    this.mcpOAuth = options.mcpOAuth ?? null;
    this.mcpProbeProvider = options.mcpProbeProvider ?? null;
    this.openSettingsCallback = options.openSettings ?? null;
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const activeNames = new Set(this.mcpManager.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'pivi-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-icon' });
    appendMcpIcon(this.iconEl);

    this.badgeEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-badge' });
    this.statusEl = iconWrapper.createDiv({ cls: 'pivi-mcp-selector-status' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'pivi-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-header' });
    headerEl.setText('MCP servers');

    const summary = this.mcpManager?.getAvailabilitySummary();
    if (summary) {
      const summaryEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-summary' });
      summaryEl.setText(this.getAvailabilityText(summary));
    }

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'pivi-mcp-selector-list' });

    const allServers = this.mcpManager?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'pivi-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'pivi-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    itemEl.setAttribute('role', 'checkbox');
    itemEl.setAttribute('tabindex', '0');
    itemEl.setAttribute('aria-label', `${server.name} MCP server`);
    itemEl.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-check' });
    if (isEnabled) {
      appendCheckIcon(checkEl);
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-cs-badge' });
      csEl.setText('Mention');
      csEl.setAttribute('title', `Context-saving: active only when selected here or mentioned as @${server.name}`);
    } else {
      const activeEl = infoEl.createSpan({ cls: 'pivi-mcp-selector-cs-badge' });
      activeEl.setText('Active');
      activeEl.setAttribute('title', 'Available to the current turn while this server is enabled in settings');
    }

    const actionsEl = itemEl.createDiv({ cls: 'pivi-mcp-selector-actions' });
    this.renderServerActions(actionsEl, server);

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
    itemEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private renderServerActions(actionsEl: HTMLElement, server: ManagedMcpServer): void {
    if (supportsMcpOAuth(server) && this.mcpOAuth) {
      const authButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Auth',
        type: 'button',
      });
      authButton.setAttribute('aria-label', `Authenticate ${server.name} MCP server`);
      authButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      authButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runToolbarAction(async () => {
          const status = await this.mcpOAuth?.authenticate(server);
          new Notice(
            status === 'authenticated'
              ? `MCP server "${server.name}" authenticated.`
              : `MCP server "${server.name}" authentication status: ${status ?? 'unknown'}.`,
          );
        }, `Failed to authenticate MCP server "${server.name}"`);
      });
    }

    if (this.mcpProbeProvider) {
      const testButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Test',
        type: 'button',
      });
      testButton.setAttribute('aria-label', `Test ${server.name} MCP server`);
      testButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      testButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runToolbarAction(async () => {
          const result = await this.mcpProbeProvider?.testServer(server.name);
          const toolCount = result?.toolCount ?? 0;
          new Notice(`MCP server "${server.name}" reachable (${toolCount} tool${toolCount === 1 ? '' : 's'}).`);
        }, `Failed to test MCP server "${server.name}"`);
      });
    }

    if (this.openSettingsCallback) {
      const settingsButton = actionsEl.createEl('button', {
        cls: 'pivi-mcp-selector-action',
        text: 'Settings',
        type: 'button',
      });
      settingsButton.setAttribute('aria-label', 'Open MCP settings');
      settingsButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      settingsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openSettingsCallback?.();
      });
    }
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector<HTMLElement>('.pivi-mcp-selector-check');

    if (isEnabled) {
      itemEl.addClass('enabled');
      itemEl.setAttribute('aria-checked', 'true');
      if (checkEl) appendCheckIcon(checkEl);
    } else {
      itemEl.removeClass('enabled');
      itemEl.setAttribute('aria-checked', 'false');
      if (checkEl) checkEl.empty();
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl || !this.statusEl) return;

    const count = this.enabledServers.size;
    const summary = this.mcpManager?.getAvailabilitySummary();
    const hasServers = (summary?.totalCount || 0) > 0;

    // Show/hide container based on whether there are servers and visibility
    if (!hasServers || !this.visible) {
      this.container.addClass('pivi-hidden');
      return;
    }
    this.container.removeClass('pivi-hidden');

    const alwaysActiveCount = summary?.alwaysActiveCount ?? 0;
    const selectedMentionOnlyCount = this.getSelectedMentionOnlyCount();
    const effectiveCount = alwaysActiveCount + selectedMentionOnlyCount;
    this.statusEl.setText(effectiveCount > 0 ? String(effectiveCount) : '0');
    this.statusEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', this.getEffectiveAvailabilityTitle(alwaysActiveCount, selectedMentionOnlyCount));
      this.badgeEl.removeClass('visible');
    }
  }

  private getSelectedMentionOnlyCount(): number {
    const servers = this.mcpManager?.getServers() ?? [];
    return servers.filter((server) => server.enabled && server.contextSaving && this.enabledServers.has(server.name)).length;
  }

  private getAvailabilityText(summary: { enabledCount: number; alwaysActiveCount: number; contextSavingCount: number }): string {
    if (summary.enabledCount === 0) {
      return 'No enabled MCP servers. Enable one in settings to use it in a turn.';
    }

    const parts: string[] = [];
    if (summary.alwaysActiveCount > 0) {
      parts.push(`${summary.alwaysActiveCount} always active`);
    }
    if (summary.contextSavingCount > 0) {
      parts.push(`${summary.contextSavingCount} mention/selection only`);
    }
    return parts.join(' · ');
  }

  private getEffectiveAvailabilityTitle(alwaysActiveCount: number, selectedCount: number): string {
    const effectiveCount = alwaysActiveCount + selectedCount;
    if (effectiveCount > 0) {
      const parts: string[] = [`${effectiveCount} MCP server${effectiveCount > 1 ? 's' : ''} available this turn`];
      if (alwaysActiveCount > 0) {
        parts.push(`${alwaysActiveCount} always active`);
      }
      if (selectedCount > 0) {
        parts.push(`${selectedCount} selected`);
      }
      return `${parts.join(' · ')} (click to manage)`;
    }

    return 'No MCP servers available this turn. Select a mention-only server or enable servers in settings.';
  }
}
