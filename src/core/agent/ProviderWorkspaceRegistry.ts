import type ObsiusPlugin from '../../main';
import { HomeFileAdapter } from '../storage/HomeFileAdapter';
import type { ProviderCommandCatalog } from './commands/ProviderCommandCatalog';
import type {
  AgentMentionProvider,
  ProviderRuntimeCommandLoader,
  ProviderSettingsTabRenderer,
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from './types';

/**
 * Registry for Pi-owned workspace/bootstrap services (commands, MCP, settings tabs).
 */
export class ProviderWorkspaceRegistry {
  private static registration: ProviderWorkspaceRegistration | null = null;
  private static services: ProviderWorkspaceServices | null = null;

  static install(registration: ProviderWorkspaceRegistration): void {
    if (this.registration) {
      return;
    }
    this.registration = registration;
  }

  private static getWorkspaceRegistration(): ProviderWorkspaceRegistration {
    if (!this.registration) {
      throw new Error('Provider workspace is not installed.');
    }
    return this.registration;
  }

  static async initializeAll(plugin: ObsiusPlugin): Promise<void> {
    const storage = plugin.storage;
    const vaultAdapter = storage.getAdapter();
    const homeAdapter = new HomeFileAdapter();

    this.services = await this.getWorkspaceRegistration().initialize({
      plugin,
      storage,
      vaultAdapter,
      homeAdapter,
    });
  }

  static clear(): void {
    this.services = null;
  }

  static getServices(): ProviderWorkspaceServices | null {
    return this.services;
  }

  static requireServices(): ProviderWorkspaceServices {
    const services = this.getServices();
    if (!services) {
      throw new Error('Provider workspace is not initialized.');
    }
    return services;
  }

  static getCommandCatalog(): ProviderCommandCatalog | null {
    return this.getServices()?.commandCatalog ?? null;
  }

  static getAgentMentionProvider(): AgentMentionProvider | null {
    return this.getServices()?.agentMentionProvider ?? null;
  }

  static async refreshAgentMentions(): Promise<void> {
    await this.getServices()?.refreshAgentMentions?.();
  }

  static getRuntimeCommandLoader(): ProviderRuntimeCommandLoader | null {
    return this.getServices()?.runtimeCommandLoader ?? null;
  }

  static getTabWarmupPolicy(): ProviderTabWarmupPolicy | null {
    return this.getServices()?.tabWarmupPolicy ?? null;
  }

  static getMcpServerManager() {
    return this.getServices()?.mcpServerManager ?? null;
  }

  static getSettingsTabRenderer(): ProviderSettingsTabRenderer | null {
    return this.getServices()?.settingsTabRenderer ?? null;
  }
}
