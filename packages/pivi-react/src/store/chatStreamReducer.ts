import type {
  ChatMessage,
  StreamChunk,
  SubagentInfo,
  ToolCallInfo,
  UsageInfo,
} from '@pivi/pivi-agent-core/foundation';

export interface ChatStreamSnapshot {
  readonly message: ChatMessage;
  readonly currentTextContent: string;
  readonly currentThinkingContent: string;
  readonly usage: UsageInfo | null;
}

export function createChatStreamSnapshot(message: ChatMessage): ChatStreamSnapshot {
  return {
    message,
    currentTextContent: '',
    currentThinkingContent: '',
    usage: null,
  };
}

function resolveToolResultStatus(
  blocked: boolean | undefined,
  isError?: boolean,
): ToolCallInfo['status'] {
  if (blocked) return 'blocked';
  if (isError) return 'error';
  return 'completed';
}

function appendContentBlock(
  message: ChatMessage,
  type: 'text' | 'thinking',
  content: string,
): ChatMessage {
  const blocks = message.contentBlocks ?? [];
  const last = blocks.at(-1);
  const contentBlocks = last?.type === type
    ? [...blocks.slice(0, -1), { ...last, content: last.content + content }]
    : [...blocks, { type, content }];
  return { ...message, contentBlocks };
}

function reduceToolUse(message: ChatMessage, chunk: Extract<StreamChunk, { type: 'tool_use' }>): ChatMessage {
  const existing = message.toolCalls?.find(toolCall => toolCall.id === chunk.id);
  if (existing) {
    return {
      ...message,
      toolCalls: message.toolCalls?.map(toolCall => toolCall.id === chunk.id
        ? { ...toolCall, input: { ...toolCall.input, ...chunk.input } }
        : toolCall),
    };
  }

  const toolCall: ToolCallInfo = {
    id: chunk.id,
    name: chunk.name,
    input: { ...chunk.input },
    status: 'running',
    startedAt: Date.now(),
    isExpanded: false,
  };
  return {
    ...message,
    toolCalls: [...(message.toolCalls ?? []), toolCall],
    contentBlocks: [...(message.contentBlocks ?? []), { type: 'tool_use', toolId: chunk.id }],
  };
}

function reduceToolResult(message: ChatMessage, chunk: Extract<StreamChunk, { type: 'tool_result' }>): ChatMessage {
  if (!message.toolCalls?.some(toolCall => toolCall.id === chunk.id)) return message;
  return {
    ...message,
    toolCalls: message.toolCalls.map(toolCall => toolCall.id === chunk.id
      ? {
          ...toolCall,
          status: resolveToolResultStatus(chunk.blocked, chunk.isError),
          completedAt: toolCall.completedAt ?? Date.now(),
          result: chunk.content,
          ...(chunk.toolUseResult ? { toolUseResult: chunk.toolUseResult } : {}),
        }
      : toolCall),
  };
}

function updateSubagent(
  message: ChatMessage,
  subagentId: string,
  update: (subagent: SubagentInfo) => SubagentInfo,
): ChatMessage {
  let changed = false;
  const toolCalls = message.toolCalls?.map(toolCall => {
    if (toolCall.subagent?.id !== subagentId && toolCall.id !== subagentId) return toolCall;
    changed = true;
    const subagent = toolCall.subagent ?? {
      id: subagentId,
      description: '',
      isExpanded: false,
      status: 'running' as const,
      toolCalls: [],
    };
    return { ...toolCall, subagent: update(subagent) };
  });
  return changed ? { ...message, toolCalls } : message;
}

/**
 * Pure, exhaustive stream projector. Runtime sequencing and rendering side effects
 * remain in the app orchestrator; this reducer owns serializable message merges.
 */
export function reduceChatStreamSnapshot(
  state: ChatStreamSnapshot,
  chunk: StreamChunk,
): ChatStreamSnapshot {
  switch (chunk.type) {
    case 'text':
      return {
        ...state,
        message: {
          ...appendContentBlock(state.message, 'text', chunk.content),
          content: state.message.content + chunk.content,
        },
        currentTextContent: state.currentTextContent + chunk.content,
        currentThinkingContent: '',
      };
    case 'thinking':
      return {
        ...state,
        message: appendContentBlock(state.message, 'thinking', chunk.content),
        currentThinkingContent: state.currentThinkingContent + chunk.content,
        currentTextContent: '',
      };
    case 'tool_use':
      return { ...state, message: reduceToolUse(state.message, chunk), currentTextContent: '' };
    case 'tool_result':
      return { ...state, message: reduceToolResult(state.message, chunk) };
    case 'tool_output':
      return {
        ...state,
        message: {
          ...state.message,
          toolCalls: state.message.toolCalls?.map(toolCall => toolCall.id === chunk.id
            ? { ...toolCall, result: (toolCall.result ?? '') + chunk.content }
            : toolCall),
        },
      };
    case 'usage':
      return { ...state, usage: { ...chunk.usage } };
    case 'notice': {
      const content = `\n\n⚠️ **${chunk.level === 'warning' ? 'Blocked' : 'Notice'}:** ${chunk.content}`;
      return {
        ...state,
        message: {
          ...appendContentBlock(state.message, 'text', content),
          content: state.message.content + content,
        },
        currentTextContent: state.currentTextContent + content,
      };
    }
    case 'error': {
      const content = `\n\n❌ **Error:** ${chunk.content}`;
      return {
        ...state,
        message: {
          ...appendContentBlock(state.message, 'text', content),
          content: state.message.content + content,
        },
        currentTextContent: state.currentTextContent + content,
      };
    }
    case 'context_compacted': {
      const lastBlock = state.message.contentBlocks?.at(-1);
      if (lastBlock?.type === 'context_compacted') return state;
      return {
        ...state,
        message: {
          ...state.message,
          contentBlocks: [...(state.message.contentBlocks ?? []), { type: 'context_compacted' }],
        },
        currentTextContent: '',
        currentThinkingContent: '',
      };
    }
    case 'subagent_text':
      return {
        ...state,
        message: updateSubagent(state.message, chunk.subagentId, subagent => ({
          ...subagent,
          result: (subagent.result ?? '') + chunk.content,
        })),
      };
    case 'subagent_tool_use':
      return {
        ...state,
        message: updateSubagent(state.message, chunk.subagentId, subagent => ({
          ...subagent,
          toolCalls: [...subagent.toolCalls, {
            id: chunk.id,
            name: chunk.name,
            input: { ...chunk.input },
            status: 'running',
            startedAt: Date.now(),
          }],
        })),
      };
    case 'subagent_tool_result':
      return {
        ...state,
        message: updateSubagent(state.message, chunk.subagentId, subagent => ({
          ...subagent,
          toolCalls: subagent.toolCalls.map(toolCall => toolCall.id === chunk.id
            ? {
                ...toolCall,
                result: chunk.content,
                status: resolveToolResultStatus(chunk.blocked, chunk.isError),
                completedAt: toolCall.completedAt ?? Date.now(),
                ...(chunk.toolUseResult ? { toolUseResult: chunk.toolUseResult } : {}),
              }
            : toolCall),
        })),
      };
    case 'async_subagent_result': {
      const subagentId = chunk.subagentId ?? chunk.agentId;
      return {
        ...state,
        message: updateSubagent(state.message, subagentId, subagent => ({
          ...subagent,
          ...(chunk.result !== undefined ? { result: chunk.result } : {}),
          status: chunk.status,
          asyncStatus: chunk.status,
          completedAt: subagent.completedAt,
        })),
      };
    }
    case 'user_message_start':
    case 'assistant_message_start':
    case 'done':
    case 'context_compacting':
      return state;
  }
}
