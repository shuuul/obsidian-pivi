import {
  deriveTodoVisualizationModel,
  extractLastTodosFromMessages,
  extractLastTodoVisualizationFromMessages,
  parseTodoToolInput,
  TOOL_TODO_WRITE,
} from '@pivi/pivi-agent-core/tools';

describe('todo visualization model', () => {
  it('parses todo tool input with valid todos', () => {
    const todos = parseTodoToolInput({
      todos: [
        { id: 'a', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      ],
    }, 'tool-1');

    expect(todos).toEqual([
      {
        id: 'a',
        content: 'Run tests',
        status: 'in_progress',
        activeForm: 'Running tests',
        sourceToolCallId: 'tool-1',
      },
    ]);
  });

  it('ignores malformed todos', () => {
    const todos = parseTodoToolInput({
      todos: [
        { content: '', status: 'pending' },
        { content: 'Valid', status: 'pending' },
        { content: 'Invalid status', status: 'blocked' },
      ],
    });

    expect(todos).toEqual([{ id: 'todo-2-valid', content: 'Valid', status: 'pending' }]);
  });

  it('derives progress counts', () => {
    const model = deriveTodoVisualizationModel([
      { id: 'a', content: 'A', status: 'completed' },
      { id: 'b', content: 'B', status: 'in_progress' },
      { id: 'c', content: 'C', status: 'pending' },
    ], 'tool');

    expect(model.activeItemId).toBe('b');
    expect(model.progress).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1 });
  });

  it('restores latest TodoWrite from messages', () => {
    const messages = [
      {
        role: 'assistant',
        toolCalls: [{ id: 'old', name: TOOL_TODO_WRITE, input: { todos: [{ content: 'Old', status: 'completed' }] } }],
      },
      {
        role: 'assistant',
        toolCalls: [{ id: 'new', name: TOOL_TODO_WRITE, input: { todos: [{ content: 'New', status: 'pending' }] } }],
      },
    ];
    const model = extractLastTodoVisualizationFromMessages(messages);

    expect(model?.source).toBe('session-history');
    expect(model?.items).toEqual([
      { id: 'todo-1-new', content: 'New', status: 'pending', sourceToolCallId: 'new' },
    ]);
    expect(extractLastTodosFromMessages(messages)).toEqual(model?.items);
  });
});
