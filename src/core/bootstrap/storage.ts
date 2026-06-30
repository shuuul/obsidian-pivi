import type { AppTabManagerState } from '../agent/types';
import type { VaultFileAdapter } from '../storage/VaultFileAdapter';

/**
 * Minimal shared app storage contract.
 *
 * This interface covers only the storage concerns that are shared across
 * the app: Pivi settings, tab manager state, and session metadata.
 *
 * Adaptor-specific storage (slash commands, skills, agents, MCP config) lives
 * behind workspace services registered at bootstrap.
 */
export interface SharedAppStorage {
  initialize(): Promise<{ pivi: Record<string, unknown> }>;
  savePiviSettings(settings: Record<string, unknown>): Promise<void>;
  setTabManagerState(state: AppTabManagerState): Promise<void>;
  getTabManagerState(): Promise<AppTabManagerState | null>;
  getAdapter(): VaultFileAdapter;
}
