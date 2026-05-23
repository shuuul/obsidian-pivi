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

export class PiCliResolver {
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    try {
      return require.resolve('@earendil-works/pi-coding-agent/dist/cli.js');
    } catch {
      return 'pi';
    }
  }
  reset() {}
}

export async function createPiWorkspaceServices(): Promise<PiWorkspaceServices> {
  return {
    cliResolver: new PiCliResolver(),
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
