import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import type { ToolUseResult } from '@pivi/pivi-agent-core/foundation';

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

/**
 * Adapts AgentEvent from pi-agent-core into StreamChunk[] consumed by the chat UI.
 *
 * Agent emits high-level lifecycle events; the chat UI expects a flat stream of
 * StreamChunk variants. This adapter bridges the two by extracting text/thinking
 * deltas from the nested AssistantMessageEvent inside message_update events.
 */
export class PiAgentEventAdapter {
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
        return [{
          type: 'tool_result',
          id: endEvent.toolCallId,
          content: resultText || (endEvent.isError ? 'Tool failed' : 'Tool completed'),
          isError: endEvent.isError,
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
          const enhanced = this.enhanceErrorMessage(msg.errorMessage, msg);
          return [{ type: 'error', content: enhanced }];
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

  private enhanceErrorMessage(errorMessage: string, msg: Record<string, unknown>): string {
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
