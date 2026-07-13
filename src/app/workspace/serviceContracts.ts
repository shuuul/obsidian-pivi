import type { AgentHostContext } from '@pivi/obsidian-host/bootstrap/hostContext';
import type { SharedAppStorage } from '@pivi/obsidian-host/bootstrap/storage';
import type { FileStore, HomeFileStore } from '@pivi/pivi-agent-core/ports';

export interface WorkspaceInitContext {
  host: AgentHostContext;
  storage: SharedAppStorage;
  vaultAdapter: FileStore;
  homeAdapter: HomeFileStore;
}
