import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { type AssistantMessage, type AssistantMessageEvent, isContextOverflow } from '@earendil-works/pi-ai';

import type { StreamChunk } from '../../foundation';
import type { ToolUseResult } from '../../foundation';
import { formatContextLimit } from '../../foundation/settingsEnv';
import { extractTextContent } from '../../runtime/messageContent';

function extractUserMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return extractTextContent(content as Array<{ type: string; text?: string }>);
  }
  return '';
}

/** Diagnostics the runtime attaches to context-overflow errors. */
export interface PiChatErrorContext {
  /** Serving model key, e.g. "openai-codex/gpt-5.3-codex-spark". */
  model: string;
  /** Serving model's context window in tokens; 0 when unknown. */
  contextWindow: number;
  /** Last known context usage in tokens, when available. */
  contextTokens?: number;
}

export type PiChatErrorContextResolver = (
  message: Record<string, unknown>,
) => PiChatErrorContext | null;

function messageModelLabel(msg: Record<string, unknown>): string {
  const provider = typeof msg.provider === 'string' ? msg.provider : '';
  const model = typeof msg.model === 'string' ? msg.model : '';
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return model || provider;
}

/**
 * Adapts AgentEvent from pi-agent-core into StreamChunk[] consumed by the chat UI.
 *
 * Agent emits high-level lifecycle events; the chat UI expects a flat stream of
 * StreamChunk variants. This adapter bridges the two by extracting text/thinking
 * deltas from the nested AssistantMessageEvent inside message_update events.
 */
export class PiAgentEventAdapter {
  constructor(private readonly resolveErrorContext?: PiChatErrorContextResolver) {}
  adapt(event: AgentEvent): StreamChunk[] {
    switch (event.type) {
      case 'turn_start':
        return [];

      case 'message_start': {
        const msg = event.message as unknown as Record<string, unknown>;
        if (msg.role === 'user') {
          return [{ type: 'user_message_start', content: extractUserMessageText(msg.content) }];
        }
        if (msg.role === 'assistant') {
          return [{ type: 'assistant_message_start' }];
        }
        return [];
      }

      case 'message_update': {
        return this.adaptMessageUpdate(event.assistantMessageEvent);
      }

      case 'tool_execution_start':
        return [{
          type: 'tool_use',
          id: event.toolCallId,
          name: event.toolName,
          input: event.args as Record<string, unknown>,
        }];

      case 'tool_execution_update': {
        const updateEvent = event as unknown as { partialResult?: { content?: Array<{ type: string; text?: string }> }; toolCallId: string };
        if (updateEvent.partialResult?.content) {
          const textContent = extractTextContent(updateEvent.partialResult.content);
          if (textContent) {
            return [{ type: 'tool_output', id: updateEvent.toolCallId, content: textContent }];
          }
        }
        return [];
      }

      case 'tool_execution_end': {
        const endEvent = event as unknown as { result?: { content?: Array<{ type: string; text?: string }>; details?: unknown }; toolCallId: string; isError?: boolean };
        const resultText = extractTextContent(endEvent.result?.content);
        const rawDetails = endEvent.result?.details;
        const toolUseResult = rawDetails && typeof rawDetails === 'object'
          ? rawDetails as ToolUseResult
          : undefined;
        const blocked = toolUseResult?.blocked === true;
        return [{
          type: 'tool_result',
          id: endEvent.toolCallId,
          content: resultText || (endEvent.isError ? 'Tool failed' : 'Tool completed'),
          isError: endEvent.isError,
          ...(blocked ? { blocked: true } : {}),
          ...(toolUseResult ? { toolUseResult } : {}),
        }];
      }

      case 'agent_end':
        return [{ type: 'done' }];

      // When the LLM call fails, agent-core emits message_end with
      // errorMessage on the assistant message — this is the only place the
      // error surfaces, so we must extract it here.
      case 'message_end': {
        const msg = event.message as unknown as Record<string, unknown>;
        if (msg.role === 'assistant' && typeof msg.errorMessage === 'string' && msg.errorMessage) {
          return [this.adaptAssistantError(msg)];
        }
        return [];
      }

      // Events not mapped to UI chunks
      case 'agent_start':
      case 'turn_end':
        return [];

      default:
        return [];
    }
  }

  adaptAssistantError(message: Record<string, unknown>): Extract<StreamChunk, { type: 'error' }> {
    const errorMessage = typeof message.errorMessage === 'string' && message.errorMessage
      ? message.errorMessage
      : 'An unknown error occurred';
    return {
      type: 'error',
      content: this.enhanceErrorMessage(errorMessage, message),
    };
  }

  private enhanceErrorMessage(errorMessage: string, msg: Record<string, unknown>): string {
    if (isContextOverflow(msg as unknown as AssistantMessage)) {
      return this.enhanceContextOverflowError(errorMessage, msg);
    }
    if (!/^Connection error\.?$/i.test(errorMessage)) {
      return errorMessage;
    }
    const provider = msg.provider as string | undefined;
    const model = msg.model as string | undefined;
    const parts = [errorMessage];
    if (provider || model) {
      parts.push(`Provider: ${provider ?? 'unknown'}, Model: ${model ?? 'unknown'}.`);
    }
    parts.push(
      'Check that the API endpoint is reachable from your network. If you are behind a proxy or firewall, ensure it allows connections to the provider URL.',
    );
    if (provider === 'opencode' || provider === 'opencode-go') {
      parts.push(
        'In Pivi settings, set OPENCODE_API_KEY under Pi agent setup (pi-coding-agent shell env is not inherited by Obsidian).',
      );
    }
    return parts.join(' ');
  }

  /**
   * Provider overflow errors name neither the model nor its window, which made
   * mid-session model switches invisible. Append the serving model, its context
   * window, last known usage, and the way out (compact or new session).
   */
  private enhanceContextOverflowError(errorMessage: string, msg: Record<string, unknown>): string {
    const context = this.resolveErrorContext?.(msg);
    const model = context?.model || messageModelLabel(msg);
    const parts = [errorMessage];
    if (model) {
      parts.push(`Model: ${model}.`);
    }
    if (context?.contextWindow) {
      parts.push(`Context window: ${formatContextLimit(context.contextWindow)} tokens.`);
    }
    if (context?.contextTokens) {
      parts.push(`Current context usage: ~${formatContextLimit(context.contextTokens)} tokens.`);
    }
    parts.push('Run /compact to shrink the session history, or start a new session.');
    return parts.join(' ');
  }

  private adaptMessageUpdate(evt: AssistantMessageEvent): StreamChunk[] {
    switch (evt.type) {
      case 'text_delta':
        return [{ type: 'text', content: evt.delta }];

      case 'thinking_delta':
        return [{ type: 'thinking', content: evt.delta }];

      // If the agent loop forwards the raw stream error event as a
      // message_update, surface it as an error chunk (safety net — current
      // agent-core emits message_end instead, but this guards against future
      // changes).
      case 'error': {
        const errorMsg = (evt as Record<string, unknown>)?.error;
        const message = typeof errorMsg === 'object' && errorMsg !== null
          ? (errorMsg as Record<string, unknown>).errorMessage
          : undefined;
        return [{
          type: 'error',
          content: typeof message === 'string' && message
            ? message
            : 'An unknown error occurred',
        }];
      }

      // Structural events with no direct UI chunk equivalent
      case 'start':
      case 'text_start':
      case 'text_end':
      case 'thinking_start':
      case 'thinking_end':
      case 'toolcall_start':
      case 'toolcall_delta':
      case 'toolcall_end':
      case 'done':
        return [];

      default:
        return [];
    }
  }
}
