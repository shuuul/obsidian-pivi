import { TOOL_OBSIDIAN_EDIT } from '../../../../src/core/tools/obsidianToolNames';
import {
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_WRITE,
} from '../../../../src/core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../../src/core/types';
import {
  handleRegularToolResult,
  type RegularToolResultDeps,
} from '../../../../src/features/chat/controllers/regularToolResultHandling';
import { updateToolCallResult } from '../../../../src/features/chat/rendering/ToolCallRenderer';
import {
  finalizeWriteEditBlock,
  type WriteEditState,
  updateWriteEditWithDiff,
} from '../../../../src/features/chat/rendering/WriteEditRenderer';
import { ChatState } from '../../../../src/features/chat/state/ChatState';

jest.mock('../../../../src/features/chat/rendering/ToolCallRenderer', () => ({
  isBlockedToolResult: jest.fn((content: unknown, isError?: boolean) => {
    const text = String(content).toLowerCase();
    return !!isError || text.includes('user denied') || text.includes('approval');
  }),
  updateToolCallResult: jest.fn(),
}));

jest.mock('../../../../src/features/chat/rendering/WriteEditRenderer', () => ({
  finalizeWriteEditBlock: jest.fn(),
  updateWriteEditWithDiff: jest.fn(),
}));

const mockUpdateToolCallResult = jest.mocked(updateToolCallResult);
const mockFinalizeWriteEditBlock = jest.mocked(finalizeWriteEditBlock);
const mockUpdateWriteEditWithDiff = jest.mocked(updateWriteEditWithDiff);

function createToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'tool-1',
    name: 'Read',
    input: { path: 'note.md' },
    status: 'running',
    ...overrides,
  };
}

function createMessage(toolCall?: ToolCallInfo): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    toolCalls: toolCall ? [toolCall] : undefined,
  };
}

function createDeps(state = new ChatState()): RegularToolResultDeps & {
  renderPendingTool: jest.Mock;
  cancelPendingToolOutputRender: jest.Mock;
  notifyVaultFileChange: jest.Mock;
  notifyObsidianVaultPathChange: jest.Mock;
  notifyApplyPatchFileChanges: jest.Mock;
  showThinkingIndicator: jest.Mock;
} {
  return {
    state,
    renderPendingTool: jest.fn(),
    cancelPendingToolOutputRender: jest.fn(),
    notifyVaultFileChange: jest.fn(),
    notifyObsidianVaultPathChange: jest.fn(),
    notifyApplyPatchFileChanges: jest.fn(),
    showThinkingIndicator: jest.fn(),
  };
}

function createWriteEditState(toolCall: ToolCallInfo): WriteEditState {
  const el = {} as HTMLElement;
  return {
    wrapperEl: el,
    contentEl: el,
    headerEl: el,
    nameEl: el,
    summaryEl: el,
    statsEl: el,
    statusEl: el,
    toolCall,
    isExpanded: false,
  };
}

describe('handleRegularToolResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders pending tools before updating a normal tool result', () => {
    const state = new ChatState();
    state.pendingTools.set('tool-1', { toolCall: createToolCall(), parentEl: {} as HTMLElement });
    const deps = createDeps(state);
    const toolCall = createToolCall();
    const msg = createMessage(toolCall);

    handleRegularToolResult(deps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'ok',
    }, msg, 'ok');

    expect(deps.renderPendingTool).toHaveBeenCalledWith('tool-1');
    expect(toolCall.status).toBe('completed');
    expect(toolCall.result).toBe('ok');
    expect(deps.cancelPendingToolOutputRender).toHaveBeenCalledWith('tool-1');
    expect(mockUpdateToolCallResult).toHaveBeenCalledWith('tool-1', toolCall, state.toolCallElements);
    expect(deps.showThinkingIndicator).toHaveBeenCalled();
  });

  it('marks blocked results and skips file notifications', () => {
    const deps = createDeps();
    const toolCall = createToolCall({ name: TOOL_WRITE, input: { file_path: 'note.md' } });

    handleRegularToolResult(deps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'user denied access',
    }, createMessage(toolCall), 'user denied access');

    expect(toolCall.status).toBe('blocked');
    expect(deps.notifyVaultFileChange).not.toHaveBeenCalled();
    expect(deps.notifyObsidianVaultPathChange).not.toHaveBeenCalled();
    expect(deps.notifyApplyPatchFileChanges).not.toHaveBeenCalled();
  });

  it('updates write/edit diff state and finalizes success', () => {
    const state = new ChatState();
    const deps = createDeps(state);
    const toolCall = createToolCall({ name: TOOL_WRITE, input: { file_path: 'note.md' } });
    const writeEditState = createWriteEditState(toolCall);
    state.writeEditStates.set('tool-1', writeEditState);

    handleRegularToolResult(deps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'done',
      toolUseResult: {
        filePath: 'note.md',
        structuredPatch: [{
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ['-old', '+new'],
        }],
      },
    }, createMessage(toolCall), 'done');

    expect(toolCall.diffData).toBeDefined();
    expect(mockUpdateWriteEditWithDiff).toHaveBeenCalledWith(writeEditState, toolCall.diffData);
    expect(mockFinalizeWriteEditBlock).toHaveBeenCalledWith(writeEditState, false);
    expect(mockUpdateToolCallResult).not.toHaveBeenCalled();
    expect(deps.notifyVaultFileChange).toHaveBeenCalledWith({ file_path: 'note.md' });
  });

  it('records AskUserQuestion resolved answers from structured results', () => {
    const deps = createDeps();
    const toolCall = createToolCall({
      name: TOOL_ASK_USER_QUESTION,
      input: { questions: [{ question: 'Proceed?', options: [] }] },
    });

    handleRegularToolResult(deps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'answered',
      toolUseResult: { answers: { 'Proceed?': 'yes' } },
    }, createMessage(toolCall), 'answered');

    expect(toolCall.resolvedAnswers).toEqual({ 'Proceed?': 'yes' });
  });

  it('routes modified-file notifications by tool family', () => {
    const editDeps = createDeps();
    handleRegularToolResult(editDeps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'ok',
    }, createMessage(createToolCall({ name: TOOL_OBSIDIAN_EDIT, input: { path: 'obs.md' } })), 'ok');
    expect(editDeps.notifyObsidianVaultPathChange).toHaveBeenCalledWith({ path: 'obs.md' });

    const patchDeps = createDeps();
    handleRegularToolResult(patchDeps, {
      type: 'tool_result',
      id: 'tool-1',
      content: 'ok',
    }, createMessage(createToolCall({ name: TOOL_APPLY_PATCH, input: { changes: [] } })), 'ok');
    expect(patchDeps.notifyApplyPatchFileChanges).toHaveBeenCalledWith({ changes: [] });
  });

  it('still shows thinking indicator when the result has no matching tool call', () => {
    const deps = createDeps();

    handleRegularToolResult(deps, {
      type: 'tool_result',
      id: 'missing',
      content: 'ok',
    }, createMessage(), 'ok');

    expect(deps.showThinkingIndicator).toHaveBeenCalled();
    expect(mockUpdateToolCallResult).not.toHaveBeenCalled();
  });
});
