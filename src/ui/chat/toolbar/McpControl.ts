import { type ManagedMcpServer, supportsMcpOAuth } from '@pivi/pivi-agent-core/mcp/types';

import type { PiviMcpServerManager } from '@/app/hostContracts';

interface AppMcpOAuth {
  authenticate(server: ManagedMcpServer): Promise<string>;
}
interface AppMcpServerProbeProvider { testServer(serverName: string): Promise<{ toolCount: number }>; }

export interface McpServerSnapshot {
  readonly name: string;
  readonly selected: boolean;
  readonly contextSaving: boolean;
  readonly oauthSupported: boolean;
  readonly canAuthenticate: boolean;
  readonly canTest: boolean;
  readonly canOpenSettings: boolean;
}
export interface McpSnapshot {
  readonly visible: boolean;
  readonly hasServers: boolean;
  readonly selectedCount: number;
  readonly effectiveCount: number;
  readonly alwaysActiveCount: number;
  readonly contextSavingCount: number;
  readonly servers: readonly McpServerSnapshot[];
}

/** Runtime-only MCP selection and recovery state. React owns all DOM presentation. */
export class McpServerSelector {
  private mcpManager: PiviMcpServerManager | null = null;
  private mcpOAuth: AppMcpOAuth | null = null;
  private mcpProbeProvider: AppMcpServerProbeProvider | null = null;
  private openSettingsCallback: (() => void) | null = null;
  private enabledServers = new Set<string>();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;
  private onSnapshotChange: ((snapshot: McpSnapshot) => void) | null = null;
  private visible = true;

  setOnSnapshotChange(callback: (snapshot: McpSnapshot) => void): void { this.onSnapshotChange = callback; callback(this.getSnapshot()); }
  setVisible(visible: boolean): void { this.visible = visible; this.emit(); }
  setMcpManager(manager: PiviMcpServerManager | null): void {
    this.mcpManager = manager;
    if (!manager && this.enabledServers.size > 0) { this.enabledServers.clear(); this.onChangeCallback?.(this.enabledServers); }
    this.pruneEnabledServers(); this.emit();
  }
  setRecoveryActions(options: { mcpOAuth?: AppMcpOAuth | null; mcpProbeProvider?: AppMcpServerProbeProvider | null; openSettings?: (() => void) | null }): void {
    this.mcpOAuth = options.mcpOAuth ?? null; this.mcpProbeProvider = options.mcpProbeProvider ?? null; this.openSettingsCallback = options.openSettings ?? null; this.emit();
  }
  setOnChange(callback: (enabled: Set<string>) => void): void { this.onChangeCallback = callback; }
  getEnabledServers(): Set<string> {
    if (!this.mcpManager) return new Set(this.enabledServers);
    const active = new Set(this.mcpManager.getServers().filter(server => server.enabled).map(server => server.name));
    return new Set([...this.enabledServers].filter(name => active.has(name)));
  }
  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) if (!this.enabledServers.has(name)) { this.enabledServers.add(name); changed = true; }
    if (changed) this.emit();
  }
  clearEnabled(): void { this.enabledServers.clear(); this.emit(); }
  resetForSession(): void { this.clearEnabled(); }
  setEnabledServers(names: string[]): void { this.enabledServers = new Set(names); this.pruneEnabledServers(); this.emit(); }
  toggleServer(name: string): void {
    this.enabledServers.has(name) ? this.enabledServers.delete(name) : this.enabledServers.add(name);
    this.onChangeCallback?.(this.enabledServers); this.emit();
  }
  async authenticate(name: string): Promise<string | null> {
    const server = this.getEnabledServer(name);
    return server && this.mcpOAuth && supportsMcpOAuth(server) ? this.mcpOAuth.authenticate(server) : null;
  }
  async testServer(name: string): Promise<{ toolCount: number } | null> { return this.mcpProbeProvider ? this.mcpProbeProvider.testServer(name) : null; }
  openSettings(): void { this.openSettingsCallback?.(); }

  getSnapshot(): McpSnapshot {
    this.pruneEnabledServers();
    const allServers = this.mcpManager?.getServers() ?? [];
    const servers = allServers.filter(server => server.enabled);
    const alwaysActiveCount = servers.filter(server => !server.contextSaving).length;
    const selectedMentionOnlyCount = servers.filter(server => server.contextSaving && this.enabledServers.has(server.name)).length;
    return {
      visible: this.visible,
      hasServers: allServers.length > 0,
      selectedCount: this.enabledServers.size,
      effectiveCount: alwaysActiveCount + selectedMentionOnlyCount,
      alwaysActiveCount,
      contextSavingCount: servers.filter(server => server.contextSaving).length,
      servers: servers.map(server => ({ name: server.name, selected: this.enabledServers.has(server.name), contextSaving: server.contextSaving, oauthSupported: supportsMcpOAuth(server), canAuthenticate: supportsMcpOAuth(server) && this.mcpOAuth !== null, canTest: this.mcpProbeProvider !== null, canOpenSettings: this.openSettingsCallback !== null })),
    };
  }
  private getEnabledServer(name: string): ManagedMcpServer | null { return this.mcpManager?.getServers().find(server => server.enabled && server.name === name) ?? null; }
  private pruneEnabledServers(): void {
    if (!this.mcpManager) return;
    const active = new Set(this.mcpManager.getServers().filter(server => server.enabled).map(server => server.name));
    let changed = false;
    for (const name of this.enabledServers) if (!active.has(name)) { this.enabledServers.delete(name); changed = true; }
    if (changed) this.onChangeCallback?.(this.enabledServers);
  }
  private emit(): void { this.onSnapshotChange?.(this.getSnapshot()); }
}
