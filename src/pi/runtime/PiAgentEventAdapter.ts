import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';

import type { StreamChunk } from '../../core/types';

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
        return [{ type: 'assistant_message_start' }];

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

      case 'tool_execution_update':
        // Partial tool results stream as tool_output for incremental display
        if (event.partialResult?.content) {
          const textContent = event.partialResult.content
            .filter((c: { type: string }) => c.type === 'text')
            .map((c: { text: string }) => c.text)
            .join('');
          if (textContent) {
            return [{ type: 'tool_output', id: event.toolCallId, content: textContent }];
          }
        }
        return [];

      case 'tool_execution_end': {
        const resultText = event.result?.content
          ? event.result.content
              .filter((c: { type: string }) => c.type === 'text')
              .map((c: { text: string }) => c.text)
              .join('')
          : '';
        return [{
          type: 'tool_result',
          id: event.toolCallId,
          content: resultText || (event.isError ? 'Tool failed' : 'Tool completed'),
          isError: event.isError,
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
          return [{ type: 'error', content: msg.errorMessage }];
        }
        return [];
      }

      // Events not mapped to UI chunks
      case 'agent_start':
      case 'message_start':
      case 'turn_end':
        return [];

      default:
        return [];
    }
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
