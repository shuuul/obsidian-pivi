import type { ImageAttachment } from '../../../../src/core/types';
import { queueTurnWhileStreaming } from '../../../../src/features/chat/controllers/inputStreamingQueue';
import { ChatState } from '../../../../src/features/chat/state/ChatState';

function createImage(id: string): ImageAttachment {
  return {
    id,
    name: `${id}.png`,
    mediaType: 'image/png',
    data: 'abc',
    size: 3,
    source: 'paste',
  };
}

function createDeps(options: {
  state?: ChatState;
  inputValue?: string;
  attachedImages?: ImageAttachment[];
} = {}) {
  const state = options.state ?? new ChatState();
  const attachedImages = options.attachedImages ?? [];
  return {
    state,
    inputEl: { value: options.inputValue ?? 'draft' },
    imageContextManager: {
      getAttachedImages: jest.fn(() => attachedImages),
      clearImages: jest.fn(),
    },
    inlineContextManager: {
      clearAfterSend: jest.fn(),
    },
    selectionController: {
      getContext: jest.fn(() => ({ notePath: 'note.md', selectedText: 'selected', lineCount: 1 })),
    },
    browserSelectionController: {
      getContext: jest.fn(() => ({ url: 'https://example.com', title: 'Example', text: 'page' })),
    },
    canvasSelectionController: {
      getContext: jest.fn(() => ({ path: 'board.canvas', selectedText: 'node' })),
    },
    getFileContextManager: jest.fn(() => ({
      getCurrentNotePath: () => 'current.md',
      shouldSendCurrentNote: () => true,
      collectContextFilePathsForTurn: () => ['linked.md'],
      transformContextMentions: (text: string) => text.replace('@note', 'note.md'),
    })),
    getMcpServerSelector: jest.fn(() => ({
      getEnabledServers: () => new Set(['vault']),
    })),
    getExternalContextSelector: jest.fn(() => ({
      getExternalContexts: () => ['https://external.example'],
      addExternalContext: jest.fn(),
    })),
    resetInputHeight: jest.fn(),
    updateQueueIndicator: jest.fn(),
  };
}

describe('queueTurnWhileStreaming', () => {
  it('queues a turn with snapshotted contexts while streaming', () => {
    const deps = createDeps();

    queueTurnWhileStreaming(deps as never, {
      content: 'Review @note',
      shouldUseInput: true,
      hasImages: false,
    });

    expect(deps.state.queuedMessage?.content).toBe('Review @note');
    expect(deps.state.queuedMessage?.turnRequest?.text).toBe('Review note.md');
    expect(deps.state.queuedMessage?.turnRequest?.currentNotePath).toBe('current.md');
    expect(deps.state.queuedMessage?.turnRequest?.attachedFilePaths).toEqual(['linked.md']);
    expect(deps.state.queuedMessage?.turnRequest?.enabledMcpServers).toEqual(new Set(['vault']));
    expect(deps.state.queuedMessage?.turnRequest?.externalContextPaths).toEqual(['https://external.example']);
    expect(deps.state.queuedMessage?.editorContext).toMatchObject({ selectedText: 'selected' });
    expect(deps.state.queuedMessage?.browserContext).toMatchObject({ url: 'https://example.com' });
    expect(deps.state.queuedMessage?.canvasContext).toMatchObject({ path: 'board.canvas' });
  });

  it('merges with an existing queued message', () => {
    const state = new ChatState();
    const deps = createDeps({ state });

    queueTurnWhileStreaming(deps as never, {
      content: 'first',
      shouldUseInput: false,
      hasImages: false,
    });
    queueTurnWhileStreaming(deps as never, {
      content: 'second',
      shouldUseInput: false,
      hasImages: false,
    });

    expect(state.queuedMessage?.content).toBe('first\n\nsecond');
    expect(state.queuedMessage?.turnRequest?.text).toBe('first\n\nsecond');
  });

  it('clears composer resources only for user-input sends', () => {
    const deps = createDeps({ inputValue: 'clear me' });

    queueTurnWhileStreaming(deps as never, {
      content: 'hello',
      shouldUseInput: true,
      hasImages: false,
    });

    expect(deps.inputEl.value).toBe('');
    expect(deps.resetInputHeight).toHaveBeenCalled();
    expect(deps.imageContextManager.clearImages).toHaveBeenCalled();
    expect(deps.inlineContextManager.clearAfterSend).toHaveBeenCalled();
    expect(deps.updateQueueIndicator).toHaveBeenCalled();

    const programmaticDeps = createDeps({ inputValue: 'keep me' });
    queueTurnWhileStreaming(programmaticDeps as never, {
      content: 'programmatic',
      shouldUseInput: false,
      hasImages: false,
    });

    expect(programmaticDeps.inputEl.value).toBe('keep me');
    expect(programmaticDeps.resetInputHeight).not.toHaveBeenCalled();
    expect(programmaticDeps.imageContextManager.clearImages).not.toHaveBeenCalled();
    expect(programmaticDeps.inlineContextManager.clearAfterSend).not.toHaveBeenCalled();
    expect(programmaticDeps.updateQueueIndicator).toHaveBeenCalled();
  });

  it('copies image override arrays before queueing', () => {
    const image = createImage('img-1');
    const imageOverride = [image];
    const deps = createDeps();

    queueTurnWhileStreaming(deps as never, {
      content: 'image please',
      shouldUseInput: false,
      hasImages: true,
      imageOverride,
    });
    imageOverride.push(createImage('img-2'));

    expect(deps.state.queuedMessage?.images).toEqual([image]);
    expect(deps.state.queuedMessage?.images).not.toBe(imageOverride);
  });
});
