import type ObsiusPlugin from '../../main';
import type { McpServerManager } from '../mcp/McpServerManager';
import { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { SlashCommandCatalog } from './commands/SlashCommandCatalog';
import type {
  AgentSettingsTabRenderer,
  AppMcpOAuth,
  AppMcpToolProvider,
  AppSkillProvider,
  WorkspaceRegistration,
  WorkspaceServices,
} from './types';

/** Pi-owned workspace services (settings tab renderer). */
export class AgentWorkspace {
  private static registration: WorkspaceRegistration | null = null;
  private static services: WorkspaceServices | null = null;

  static install(registration: WorkspaceRegistration): void {
    if (this.registration) {
      return;
    }
    this.registration = registration;
  }

  private static requireRegistration(): WorkspaceRegistration {
    if (!this.registration) {
      throw new Error('Agent workspace is not installed.');
    }
    return this.registration;
  }

  static async initializeAll(plugin: ObsiusPlugin): Promise<void> {
    const storage = plugin.storage;
    const vaultAdapter = storage.getAdapter();
    const homeAdapter = new HomeFileAdapter();

    this.services = await this.requireRegistration().initialize({
      plugin,
      storage,
      vaultAdapter,
      homeAdapter,
    });
  }

  static clear(): void {
    this.services = null;
  }

  static getServices(): WorkspaceServices | null {
    return this.services;
  }

  static requireServices(): WorkspaceServices {
    const services = this.getServices();
    if (!services) {
      throw new Error('Agent workspace is not initialized.');
    }
    return services;
  }

  static getSettingsTabRenderer(): AgentSettingsTabRenderer | null {
    return this.getServices()?.settingsTabRenderer ?? null;
  }

  static getMcpServerManager(): McpServerManager | null {
    return this.getServices()?.mcpServerManager ?? null;
  }

  static getMcpToolProvider(): AppMcpToolProvider | null {
    return this.getServices()?.mcpToolProvider ?? null;
  }

  static getSkillProvider(): AppSkillProvider | null {
    return this.getServices()?.skillProvider ?? null;
  }

  static getMcpOAuth(): AppMcpOAuth | null {
    return this.getServices()?.mcpOAuth ?? null;
  }

  static getSlashCommandCatalog(): SlashCommandCatalog | null {
    return this.getServices()?.slashCommandCatalog ?? null;
  }
}
