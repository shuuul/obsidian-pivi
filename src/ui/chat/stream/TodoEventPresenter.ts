import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import {
  deriveTodoVisualizationModel,
  extractLastTodoVisualizationFromMessages,
  parseTodoToolInput,
  type TodoVisualizationModel,
  TOOL_TODO_WRITE,
} from '@pivi/pivi-agent-core/tools';

export interface TodoEventState {
  currentTodoVisualizationModel: TodoVisualizationModel | null;
}

export interface TodoToolUseChunk {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export class TodoEventPresenter {
  constructor(private readonly state: TodoEventState) {}

  handleToolUse(chunk: TodoToolUseChunk): TodoVisualizationModel | null {
    if (chunk.name !== TOOL_TODO_WRITE) {
      return null;
    }

    const todos = parseTodoToolInput(chunk.input, chunk.id);
    if (!todos) {
      return null;
    }

    const model = deriveTodoVisualizationModel(todos, 'tool');
    this.state.currentTodoVisualizationModel = model;
    return model;
  }

  restoreFromMessages(messages: ChatMessage[]): TodoVisualizationModel | null {
    const model = extractLastTodoVisualizationFromMessages(messages);
    this.state.currentTodoVisualizationModel = model;
    return model;
  }
}
