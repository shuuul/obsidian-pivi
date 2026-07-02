import type { App } from 'obsidian';

/** Narrow host surface for Pi runtime — not the Obsidian plugin class. */
export interface PiRuntimeHost {
  app: App;
  settings: Record<string, unknown> & {
    model?: string;
    titleGenerationModel?: string;
    userName?: string;
  };
  getPiWorkspace?(): {
    providerOAuth?: { hasCodexAuth(): boolean } | null;
  } | null;
}