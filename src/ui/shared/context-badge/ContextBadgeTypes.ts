import type {
  ContextBadgeIcon,
  ContextBadgeKind,
  ContextBadgeToken,
  ContextBadgeTone,
  ContextBadgeViewModel,
} from '@pivi/pivi-react/context-badges';
import type { App } from 'obsidian';

export type {
  ContextBadgeIcon,
  ContextBadgeKind,
  ContextBadgeToken,
  ContextBadgeTone,
  ContextBadgeViewModel,
};

export interface ContextBadgeRenderOptions {
  app?: App;
  root?: HTMLElement;
  inline?: boolean;
  classNames?: string[];
  onClick?: (token: ContextBadgeToken, event: MouseEvent) => void;
  onRemove?: (token: ContextBadgeToken, event: Event) => void;
}

export type ContextBadgePart =
  | { kind: 'plain'; text: string }
  | { kind: 'badge'; token: ContextBadgeToken };
