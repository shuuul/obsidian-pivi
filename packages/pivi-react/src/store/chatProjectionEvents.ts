/** Projection event plane contract: sequenced events, diagnostics, and entity shapes published by ChatProjectionStore. */

import type {
  ChatMessage,
  ContentBlock,
} from '@pivi/agent/runtime/chatTypes';
import type {
  SubagentInfo,
  ToolCallInfo,
} from '@pivi/agent/tools';

import type { DeepReadonly } from './chatUiStore';

export interface ChatProjectionEventMetadata {
  readonly projectionScopeId: string;
  readonly sessionFile: string | null;
  readonly openSessionId: string | null;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly sequence: number;
  readonly timestamp: number;
}

interface ChatProjectionEventIds {
  readonly messageId: string | null;
  readonly blockId: string | null;
  readonly toolId: string | null;
  readonly agentId: string | null;
}

type ChatProjectionEventBase = ChatProjectionEventMetadata & ChatProjectionEventIds;

export type ChatProjectionMessageChange =
  | { readonly type: 'message.upsert' }
  | { readonly type: 'text.append'; readonly blockId: string; readonly delta: string }
  | { readonly type: 'tool.upsert'; readonly tool: ToolCallInfo }
  | { readonly type: 'agent.upsert'; readonly agent: SubagentInfo };

export type ChatProjectionEvent =
  | ChatProjectionEventBase & {
      readonly type: 'messages.replace';
      readonly messages: readonly ChatMessage[];
    }
  | ChatProjectionEventBase & {
      readonly type: 'message.upsert';
      readonly messageId: string;
      readonly message: ChatMessage;
      readonly delivery: 'immediate' | 'queued';
    }
  | ChatProjectionEventBase & {
      readonly type: 'text.append';
      readonly messageId: string;
      readonly blockId: string;
      readonly message: ChatMessage;
      readonly delta: string;
    }
  | ChatProjectionEventBase & {
      readonly type: 'tool.upsert';
      readonly messageId: string;
      readonly toolId: string;
      readonly message: ChatMessage;
      readonly tool: ToolCallInfo;
    }
  | ChatProjectionEventBase & {
      readonly type: 'agent.upsert';
      readonly messageId: string;
      readonly agentId: string;
      readonly message: ChatMessage;
      readonly agent: SubagentInfo;
    }
  | ChatProjectionEventBase & {
      readonly type: 'messages.truncate';
      readonly messageIds: readonly string[];
    }
  | ChatProjectionEventBase & { readonly type: 'messages.reveal-previous-page' }
  | ChatProjectionEventBase & {
      readonly type: 'messages.prepend-page';
      readonly messages: readonly ChatMessage[];
    }
  | ChatProjectionEventBase & { readonly type: 'projection.flush' }
  | ChatProjectionEventBase & { readonly type: 'run.terminal' };

export type ChatProjectionDiagnosticCode =
  | 'duplicate-sequence'
  | 'late-after-terminal'
  | 'missing-owner'
  | 'out-of-order-sequence';

export interface ChatProjectionDiagnostic {
  readonly code: ChatProjectionDiagnosticCode;
  readonly eventType: ChatProjectionEvent['type'];
  readonly projectionScopeId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly messageId: string | null;
  readonly blockId: string | null;
  readonly toolId: string | null;
  readonly agentId: string | null;
}

export type ChatProjectionDiagnosticListener = (diagnostic: ChatProjectionDiagnostic) => void;

export const NOOP_PROJECTION_DIAGNOSTIC_LISTENER: ChatProjectionDiagnosticListener = () => {};

export type ProjectionMessage = DeepReadonly<ChatMessage>;

export type ProjectionListener = () => void;

export interface ChatBlockEntity {
  readonly id: string;
  readonly messageId: string;
  readonly index: number;
  readonly block: ContentBlock;
}

export interface ChatToolEntity {
  readonly id: string;
  readonly messageId: string;
  readonly tool: ToolCallInfo;
}

export function getChatProjectionBlockId(messageId: string, index: number): string {
  return `${messageId}:block:${index}`;
}

export interface MessageEntityKeys {
  blockIds: string[];
  toolIds: string[];
}
