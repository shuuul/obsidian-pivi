import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import { piSettingsTabRenderer } from '../ui/PiSettingsTab';

export type PiWorkspaceServices = ProviderWorkspaceServices;

const piTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'none';
  },
};

export async function createPiWorkspaceServices(): Promise<PiWorkspaceServices> {
  return {
    settingsTabRenderer: piSettingsTabRenderer,
    tabWarmupPolicy: piTabWarmupPolicy,
  };
}

export const piWorkspaceRegistration: ProviderWorkspaceRegistration<PiWorkspaceServices> = {
  initialize: async () => createPiWorkspaceServices(),
};

export function maybeGetPiWorkspaceServices(): PiWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('pi') as PiWorkspaceServices | null;
}
