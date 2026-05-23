import type { StreamChunk } from '../../core/types';
import type { SDKToolUseResult } from '../../core/types/diff';
import type { AcpToolCall, AcpToolCallUpdate } from './types';

interface AcpToolStreamState {
  input: Record<string, unknown>;
  rawName: string;
}

export interface AcpToolStreamPresentationAdapter {
  normalizeToolInput(rawName: string | undefined, input: Record<string, unknown>): Record<string, unknown>;
  normalizeToolName(rawName: string | undefined): string;
  normalizeToolUseResult(
    rawName: string | undefined,
    input: Record<string, unknown>,
    rawOutput: unknown,
  ): SDKToolUseResult | undefined;
  resolveRawToolName(
    currentRawName: string | undefined,
    update: {
      kind?: string | null;
      title?: string | null;
    },
  ): string;
}

export class AcpToolStreamAdapter {
  private readonly toolStates = new Map<string, AcpToolStreamState>();

  constructor(private readonly adapter: AcpToolStreamPresentationAdapter) {}

  reset(): void {
    this.toolStates.clear();
  }

  normalizeToolCall(toolCall: AcpToolCall, chunks: StreamChunk[]): StreamChunk[] {
    const state = this.updateToolState(undefined, {
      kind: toolCall.kind,
      rawInput: toolCall.rawInput,
      title: toolCall.title,
    });
    this.toolStates.set(toolCall.toolCallId, state);
    return chunks.map((chunk) => this.normalizeChunk(chunk, state, toolCall.rawOutput));
  }

  normalizeToolCallUpdate(toolCallUpdate: AcpToolCallUpdate, chunks: StreamChunk[]): StreamChunk[] {
    const state = this.updateToolState(this.toolStates.get(toolCallUpdate.toolCallId), {
      kind: toolCallUpdate.kind,
      rawInput: toolCallUpdate.rawInput,
      title: toolCallUpdate.title,
    });
    this.toolStates.set(toolCallUpdate.toolCallId, state);

    const result: StreamChunk[] = [];
    if (toolCallUpdate.rawInput !== undefined) {
      result.push({
        id: toolCallUpdate.toolCallId,
        input: state.input,
        name: this.adapter.normalizeToolName(state.rawName),
        type: 'tool_use',
      });
    }

    for (const chunk of chunks) {
      result.push(this.normalizeChunk(chunk, state, toolCallUpdate.rawOutput));
    }

    return result;
  }

  private updateToolState(
    current: AcpToolStreamState | undefined,
    update: {
      kind?: string | null;
      rawInput?: unknown;
      title?: string | null;
    },
  ): AcpToolStreamState {
    const nextRawName = this.adapter.resolveRawToolName(current?.rawName, update);
    const nextInput = current?.input ?? {};

    if (update.rawInput !== undefined) {
      const rawInput = normalizeRawToolInput(update.rawInput);
      return this.buildToolState(nextRawName, { ...nextInput, ...rawInput });
    }

    if (nextRawName !== current?.rawName) {
      return this.buildToolState(nextRawName, nextInput);
    }

    return current ?? this.buildToolState(nextRawName, {});
  }

  private buildToolState(
    rawName: string,
    input: Record<string, unknown>,
  ): AcpToolStreamState {
    return {
      input: this.adapter.normalizeToolInput(rawName, input),
      rawName,
    };
  }

  private normalizeChunk(
    chunk: StreamChunk,
    state: AcpToolStreamState,
    rawOutput?: unknown,
  ): StreamChunk {
    switch (chunk.type) {
      case 'tool_use':
        return {
          ...chunk,
          input: state.input,
          name: this.adapter.normalizeToolName(state.rawName),
        };
      case 'tool_result': {
        const toolUseResult = this.adapter.normalizeToolUseResult(state.rawName, state.input, rawOutput);
        return toolUseResult
          ? { ...chunk, toolUseResult }
          : chunk;
      }
      default:
        return chunk;
    }
  }
}

function normalizeRawToolInput(rawInput: unknown): Record<string, unknown> {
  return rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : {};
}
