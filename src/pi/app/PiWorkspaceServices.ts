import { AgentWorkspace } from '../../core/agent/AgentWorkspace';
import type {
  WorkspaceRegistration,
  WorkspaceServices,
} from '../../core/agent/types';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';

export type PiWorkspaceServices = WorkspaceServices;

export async function createPiWorkspaceServices(): Promise<PiWorkspaceServices> {
  return {
    settingsTabRenderer: piSettingsTabRenderer,
  };
}

export const piWorkspaceRegistration: WorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async () => createPiWorkspaceServices(),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return AgentWorkspace.getServices() as PiWorkspaceServices | null;
}
