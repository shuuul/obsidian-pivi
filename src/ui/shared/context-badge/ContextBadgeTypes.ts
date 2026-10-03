import type { ContextBadgeToken } from '@pivi/pivi-react/context-badges';

export type {
  ContextBadgeToken,
};

export interface ContextBadgeRenderOptions {
  root?: HTMLElement;
  inline?: boolean;
  classNames?: string[];
  onClick?: (token: ContextBadgeToken, event: MouseEvent) => void;
  onRemove?: (token: ContextBadgeToken, event: Event) => void;
}
