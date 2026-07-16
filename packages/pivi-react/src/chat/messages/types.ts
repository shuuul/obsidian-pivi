import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ReactNode } from 'react';

/**
 * An imperative owner-realm adapter mounted into one React-owned empty element.
 * Cleanup must dispose every resource created by the adapter.
 */
export interface MessageContentAdapter<Value> {
  mount(
    container: HTMLElement,
    value: Value,
    context: MessageContentAdapterContext,
  ): void | (() => void);
  /** Update a mounted island in place when rebuilding it would discard UI state or async work. */
  update?(
    container: HTMLElement,
    value: Value,
    context: MessageContentAdapterContext,
  ): void;
}

export type BeginDisclosureResize = (header: HTMLElement) => void;

/** Runtime callbacks deliberately kept outside the serializable chat snapshot. */
export interface MessagePresentationActions {
  canCopy: (message: ChatMessage) => boolean;
  canFork: (message: ChatMessage) => boolean;
  canRedo: (messageId: string) => boolean;
  copy: (message: ChatMessage) => void | Promise<void>;
  fork: (messageId: string) => void | Promise<void>;
  redo: (messageId: string) => void | Promise<void>;
  scrollToRecentUser: (messageId: string) => void;
}

export interface MessageViewportHandle {
  scrollToStart: (behavior?: 'auto' | 'smooth' | 'instant') => void;
  scrollToEnd: (behavior?: 'auto' | 'smooth' | 'instant') => void;
  scrollToMessage: (
    messageId: string,
    align?: 'start' | 'center' | 'end' | 'auto',
    behavior?: 'auto' | 'smooth' | 'instant',
  ) => void;
  scrollToRecentUser: (messageId: string) => void;
  scrollToUser: (direction: 'prev' | 'next') => void;
  isAtEnd: (threshold?: number) => boolean;
}

export interface MessageContentAdapterContext {
  readonly beginDisclosureResize?: BeginDisclosureResize;
  readonly generation: string;
  readonly ownerDocument: Document;
  readonly ownerWindow: Window;
}

export interface StreamingMarkdownValue {
  readonly blockId: string;
  readonly content: string;
  readonly phase: 'streaming' | 'terminal';
}

/**
 * Imperative presentation islands that cannot yet be expressed as React.
 * Each adapter exclusively owns the children of its supplied empty slot.
 */
export interface MessageContentAdapters {
  readonly markdown?: MessageContentAdapter<StreamingMarkdownValue>;
  readonly askUser?: MessageContentAdapter<ToolCallInfo>;
  readonly subagent?: MessageContentAdapter<SubagentInfo>;
  readonly userContent?: MessageContentAdapter<ChatMessage>;
  /** Allows a host to provide another specialized tool island when needed. */
  readonly tool?: MessageContentAdapter<ToolCallInfo>;
  /** Optional React-only specialized tool presentation. */
  readonly renderToolContent?: (toolCall: ToolCallInfo) => ReactNode;
}
