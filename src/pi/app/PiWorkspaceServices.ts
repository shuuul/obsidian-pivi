import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type {
  AppMcpStorage,
  WorkspaceRegistration,
  WorkspaceServices,
} from '../../core/agent/types';
import { McpServerManager } from '../../core/mcp/McpServerManager';
import { initializeOAuth } from '../mcp/oauth/McpAuthFlow';
import { McpOAuthService } from '../mcp/oauth/McpOAuthService';
import { McpStorage } from '../storage/McpStorage';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';

export interface PiWorkspaceServices extends WorkspaceServices {
  mcpStorage: AppMcpStorage;
  mcpServerManager: McpServerManager;
  mcpOAuth: McpOAuthService;
}

export async function createPiWorkspaceServices(
  context: Parameters<WorkspaceRegistration['initialize']>[0],
): Promise<PiWorkspaceServices> {
  const mcpStorage = new McpStorage(context.vaultAdapter);
  const mcpServerManager = new McpServerManager(mcpStorage);
  const mcpOAuth = new McpOAuthService(context.vaultAdapter);
  await mcpServerManager.loadServers();
  await initializeOAuth();

  return {
    settingsTabRenderer: piSettingsTabRenderer,
    mcpStorage,
    mcpServerManager,
    mcpOAuth,
  };
}

export const piWorkspaceRegistration: WorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async (context) => createPiWorkspaceServices(context),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return AgentWorkspace.getServices() as PiWorkspaceServices | null;
}
