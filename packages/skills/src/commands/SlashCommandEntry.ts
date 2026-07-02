import type { SlashCommandSource } from '@pivi/core/settings';

export type SlashCommandKind = 'command' | 'skill';
export type SlashCommandScope = 'builtin' | 'vault' | 'user' | 'system' | 'runtime';

export interface SlashCatalogEntry {
  id: string;
  kind: SlashCommandKind;
  name: string;
  description?: string;
  content: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  scope: SlashCommandScope;
  source: SlashCommandSource;
  isEditable: boolean;
  isDeletable: boolean;
  displayPrefix: string;
  insertPrefix: string;
  /** Opaque persistence token for settings UIs. */
  persistenceKey?: string;
}
