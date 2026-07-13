import type { PiviSettings } from '@pivi/pivi-agent-core/foundation';
import type { FileStore } from '@pivi/pivi-agent-core/ports';
import type { App, EventRef } from 'obsidian';

/** Obsidian lifecycle capabilities required while constructing app-owned services. */
export interface PiviWorkspaceHost {
  app: App;
  settings: PiviSettings;
  registerEvent(eventRef: EventRef): void;
}

export interface WorkspaceInitContext {
  host: PiviWorkspaceHost;
  vaultAdapter: FileStore;
}
