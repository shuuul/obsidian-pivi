import type {
  ContextBadgeIcon,
  ContextBadgeKind,
  ContextBadgeToken,
  ContextBadgeTone,
  ContextBadgeViewModel,
} from '@pivi/pivi-react/context-badges';

export type {
  ContextBadgeIcon,
  ContextBadgeKind,
  ContextBadgeToken,
  ContextBadgeTone,
  ContextBadgeViewModel,
};

export interface ContextBadgeRenderOptions {
  root?: HTMLElement;
  inline?: boolean;
  classNames?: string[];
  onClick?: (token: ContextBadgeToken, event: MouseEvent) => void;
  onRemove?: (token: ContextBadgeToken, event: Event) => void;
}
