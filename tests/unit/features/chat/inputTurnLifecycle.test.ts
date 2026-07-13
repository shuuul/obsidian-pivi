import type { ChatTurnRequest } from '@pivi/pivi-agent-core/runtime/types';
import type { ImageAttachment } from '@pivi/pivi-agent-core/foundation';
import { beginOutgoingTurn } from '@/ui/chat/composer/ComposerTurnLifecycle';
import { ChatState } from '@/ui/chat/state/ChatState';

class FakeElement {
  private classes = new Set<string>();

  addClass(name: string): void {
    this.classes.add(name);
  }

  hasClass(name: string): boolean {
    return this.classes.has(name);
  }
}

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
  inputValue?: string;
  attachedImages?: ImageAttachment[];
  enableAutoScroll?: boolean;
  externalContextPaths?: string[];
} = {}) {
  const state = new ChatState();
  const inputEl = { value: options.inputValue ?? 'draft' };
  const renderer = { addMessage: jest.fn(() => new FakeElement()) };
  const attachedImages = options.attachedImages ?? [];
  const fileContextManager = {
    startSession: jest.fn(),
    markCurrentNoteSent: jest.fn(),
    getCurrentNotePath: () => 'current.md',
    shouldSendCurrentNote: () => true,
    collectContextFilePathsForTurn: () => ['linked.md'],
    transformContextMentions: (text: string) => text.replace('@note', 'note.md'),
  };
  const deps = {
    plugin: {
      settings: {
        enableAutoScroll: options.enableAutoScroll,
      },
    },
    state,
    renderer,
    inputEl,
    imageContextManager: {
      getAttachedImages: jest.fn(() => attachedImages),
      clearImages: jest.fn(),
    },
    fileContextManager,
    inlineContextManager: {
      clearAfterSend: jest.fn(),
    },
    selectionController: {
      getContext: jest.fn(() => null),
    },
    browserSelectionController: {
      getContext: jest.fn(() => ({ url: 'https://example.com', title: 'Example', text: 'page' })),
    },
    canvasSelectionController: {
      getContext: jest.fn(() => ({ path: 'board.canvas', selectedText: 'node' })),
    },
    getFileContextManager: jest.fn(() => fileContextManager),
    getExternalContextSelector: jest.fn(() => ({
      getExternalContexts: () => options.externalContextPaths ?? ['https://external.example'],
    })),
    getSubagentManager: jest.fn(() => ({ resetSpawnedCount: jest.fn() })),
    generateId: jest.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1'),
    resetInputHeight: jest.fn(),
  };
  return { deps, state, inputEl, renderer, fileContextManager };
}

describe('beginOutgoingTurn', () => {
  it('consumes composer state and publishes the user message', () => {
    const image = createImage('img-1');
    const { deps, state, inputEl, fileContextManager } = createDeps({
      inputValue: 'clear me',
      attachedImages: [image],
      enableAutoScroll: false,
    });

    const result = beginOutgoingTurn(deps as never, {
      content: 'Review @note',
      shouldUseInput: true,
    });

    expect(inputEl.value).toBe('');
    expect(deps.resetInputHeight).toHaveBeenCalled();
    expect(deps.imageContextManager.clearImages).toHaveBeenCalled();
    expect(deps.inlineContextManager.clearAfterSend).toHaveBeenCalled();
    expect(fileContextManager.startSession).toHaveBeenCalled();
    expect(fileContextManager.markCurrentNoteSent).toHaveBeenCalled();
    expect(state.isStreaming).toBe(true);
    expect(state.cancelRequested).toBe(false);
    expect(state.ignoreUsageUpdates).toBe(false);
    expect(state.autoScrollEnabled).toBe(false);
    expect(state.hasPendingSessionSave).toBe(true);
    expect(state.messages).toEqual([result.userMsg]);
    expect(state.uiStore.getSnapshot().messages).toEqual([result.userMsg]);
    expect(result.userMsg).toMatchObject({
      id: 'user-1',
      role: 'user',
      content: 'Review @note',
      displayContent: 'Review @note',
      images: [image],
    });
    expect(result.assistantMsg).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      toolCalls: [],
      contentBlocks: [],
    });
    expect(result.turnRequest.text).toBe('Review note.md');
    expect(result.turnRequest.currentNotePath).toBe('current.md');
    expect(result.turnRequest.attachedFilePaths).toEqual(['linked.md']);
    expect(result.turnRequest.enabledMcpServers).toBeUndefined();
    expect(result.turnRequest.externalContextPaths).toEqual(['https://external.example']);
    expect(result.imagesForMessage).toEqual([image]);
  });

  it('does not clear composer resources for programmatic sends', () => {
    const imageOverride = [createImage('override-1')];
    const { deps, inputEl } = createDeps({ inputValue: 'keep me' });

    const result = beginOutgoingTurn(deps as never, {
      content: 'programmatic',
      shouldUseInput: false,
      imageOverride,
    });
    imageOverride.push(createImage('override-2'));

    expect(inputEl.value).toBe('keep me');
    expect(deps.resetInputHeight).not.toHaveBeenCalled();
    expect(deps.imageContextManager.clearImages).not.toHaveBeenCalled();
    expect(deps.inlineContextManager.clearAfterSend).not.toHaveBeenCalled();
    expect(result.imagesForMessage).toHaveLength(1);
    expect(result.imagesForMessage).not.toBe(imageOverride);
  });

  it('clones turn request overrides', () => {
    const override: ChatTurnRequest = {
      text: 'original',
      attachedFilePaths: ['a.md'],
      externalContextPaths: ['/stale'],
      enabledMcpServers: new Set(['stale']),
    };
    const { deps } = createDeps();

    const result = beginOutgoingTurn(deps as never, {
      content: 'display only',
      shouldUseInput: false,
      turnRequestOverride: override,
    });
    result.turnRequest.attachedFilePaths?.push('b.md');

    expect(result.displayContent).toBe('display only');
    expect(result.turnRequest.text).toBe('original');
    expect(result.turnRequest.externalContextPaths).toEqual(['https://external.example']);
    expect(result.turnRequest.enabledMcpServers).toBeUndefined();
    expect(result.userMsg.turnRequest?.externalContextPaths).toEqual(['https://external.example']);
    expect(result.userMsg.turnRequest?.enabledMcpServers).toBeUndefined();
    expect(override.attachedFilePaths).toEqual(['a.md']);
    expect(override.externalContextPaths).toEqual(['/stale']);
    expect(override.enabledMcpServers).toEqual(new Set(['stale']));
  });

  it('clears stale override capabilities when current selectors are empty', () => {
    const override: ChatTurnRequest = {
      text: 'queued content',
      externalContextPaths: ['/revoked'],
      enabledMcpServers: new Set(['revoked']),
    };
    const { deps } = createDeps({
      externalContextPaths: [],
    });

    const result = beginOutgoingTurn(deps as never, {
      content: 'queued display',
      shouldUseInput: false,
      turnRequestOverride: override,
    });

    expect(result.turnRequest.text).toBe('queued content');
    expect(result.turnRequest.externalContextPaths).toBeUndefined();
    expect(result.turnRequest.enabledMcpServers).toBeUndefined();
    expect(result.userMsg.turnRequest?.externalContextPaths).toBeUndefined();
    expect(result.userMsg.turnRequest?.enabledMcpServers).toBeUndefined();
  });

  it('marks compact turns for compact thinking copy', () => {
    const { deps } = createDeps();

    const result = beginOutgoingTurn(deps as never, {
      content: '/compact summarize',
      shouldUseInput: false,
    });

    expect(result.isCompact).toBe(true);
  });
});
