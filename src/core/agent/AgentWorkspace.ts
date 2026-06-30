import type { McpServerManager } from "../mcp/McpServerManager";
import type { SlashCommandCatalog } from "./commands/SlashCommandCatalog";
import type {
  AgentSettingsTabRenderer,
  AppMcpOAuth,
  AppMcpServerProbeProvider,
  AppMcpServerTester,
  AppMcpToolProvider,
  AppModelReadinessProvider,
  AppSkillProvider,
  WorkspaceInitContext,
  WorkspaceRegistration,
  WorkspaceServices,
} from "./types";

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
      throw new Error("Agent workspace is not installed.");
    }
    return this.registration;
  }

  static async initializeAll(context: WorkspaceInitContext): Promise<void> {
    this.services = await this.requireRegistration().initialize(context);
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
      throw new Error("Agent workspace is not initialized.");
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

  static getMcpServerProbeProvider(): AppMcpServerProbeProvider | null {
    return this.getServices()?.mcpServerProbeProvider ?? null;
  }

  static getMcpServerTester(): AppMcpServerTester | null {
    return this.getServices()?.mcpServerTester ?? null;
  }

  static getModelReadinessProvider(): AppModelReadinessProvider | null {
    return this.getServices()?.modelReadinessProvider ?? null;
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
