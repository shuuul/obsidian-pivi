import type { ChatMessage } from '@pivi/agent/runtime';
import {
  extractLastTodoVisualizationFromMessages,
  type TodoVisualizationModel,
} from '@pivi/agent/tools';

export interface TodoEventState {
  currentTodoVisualizationModel: TodoVisualizationModel | null;
}

export class TodoEventPresenter {
  constructor(private readonly state: TodoEventState) {}

  restoreFromMessages(messages: ChatMessage[]): TodoVisualizationModel | null {
    const model = extractLastTodoVisualizationFromMessages(messages);
    this.state.currentTodoVisualizationModel = model;
    return model;
  }
}
