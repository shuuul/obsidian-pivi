import { ProviderWorkspaceRegistry } from '../../core/agent/ProviderWorkspaceRegistry';
import type {
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../core/agent/types';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';

export type PiWorkspaceServices = ProviderWorkspaceServices;

export async function createPiWorkspaceServices(): Promise<PiWorkspaceServices> {
  return {
    settingsTabRenderer: piSettingsTabRenderer,
  };
}

export const piWorkspaceRegistration: ProviderWorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async () => createPiWorkspaceServices(),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices() as PiWorkspaceServices | null;
}
