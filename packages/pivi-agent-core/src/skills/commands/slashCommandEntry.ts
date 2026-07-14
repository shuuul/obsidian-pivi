import type { SlashCommandSource } from '@pivi/pivi-agent-core/foundation/settings';

export type SlashCommandKind = 'command' | 'skill' | 'tool';
export type SlashCommandScope = 'builtin' | 'workspace' | 'user' | 'system' | 'runtime';

export interface SlashCatalogEntry {
  id: string;
  kind: SlashCommandKind;
  name: string;
  description?: string;
  content: string;
  argumentHint?: string;
  icon?: string;
  /** Stable opaque identity used by host command integrations. */
  integrationKey?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  /** Canonical runtime tool name for tool-kind slash entries. */
  toolName?: string;
  scope: SlashCommandScope;
  source: SlashCommandSource;
  isEditable: boolean;
  isDeletable: boolean;
  displayPrefix: string;
  insertPrefix: string;
  /** Opaque persistence token for settings UIs. */
  persistenceKey?: string;
}
