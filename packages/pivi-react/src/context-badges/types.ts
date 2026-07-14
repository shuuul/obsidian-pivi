import type { InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

export type ContextBadgeKind =
  | 'file'
  | 'folder'
  | 'mcp'
  | 'skill'
  | 'tool'
  | 'agent'
  | 'inline-context'
  | 'attachment';

export type ContextBadgeTone = 'context' | 'tool' | 'inline' | 'attachment' | 'muted';

export type ContextBadgeToken =
  | { kind: 'file'; token: string; path: string; label?: string; source?: 'workspace' | 'external' }
  | { kind: 'folder'; token: string; path: string; label?: string; source?: 'workspace' | 'external' }
  | { kind: 'mcp'; token: string; serverName: string; toolName?: string }
  | { kind: 'skill'; token: string; commandName: string; source?: string; skillPath?: string }
  | { kind: 'tool'; token: string; toolName: string; label?: string }
  | { kind: 'agent'; token: string; agentId: string; label: string; source?: string }
  | { kind: 'inline-context'; token: string; label?: string; context: InlineContextReference }
  | { kind: 'attachment'; token: string; path: string; label?: string };

export interface ContextBadgeIcon {
  name?: string;
  custom?: 'mcp';
}

export interface ContextBadgeViewModel {
  kind: ContextBadgeKind;
  token: string;
  label: string;
  tooltip?: string;
  icon: ContextBadgeIcon;
  tone: ContextBadgeTone;
  clickable: boolean;
  removable: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  removeAriaLabel?: string;
}
