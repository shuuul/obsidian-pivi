import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';

import { InputController } from '@/ui/chat/controllers/InputController';
import { ChatState } from '@/ui/chat/state/ChatState';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';

function createService(events: string[]): PiChatService {
  return {
    prepareTurn: jest.fn(request => {
      events.push('prepare');
      return {
        request,
        displayContent: request.text,
        persistedContent: request.text,
        isCompact: false,
      };
    }),
    query: jest.fn(async function* () {
      events.push('query');
      yield* [];
    }),
    cancel: jest.fn(() => events.push('cancel')),
    steer: jest.fn(() => true),
    consumeTurnMetadata: jest.fn(() => ({})),
  } as unknown as PiChatService;
}

function createController() {
  const events: string[] = [];
  const state = new ChatState();
  state.currentOpenSessionId = 'open-session';
  const inputEl = { value: '', focus: jest.fn() };
  const service = createService(events);
  let currentService: PiChatService | null = null;
  let id = 0;
  const ensureServiceInitialized = jest.fn(async () => {
    events.push('init');
    currentService ??= service;
    return true;
  });
  const contentEl = {} as HTMLElement;
  const messageEl = { querySelector: jest.fn(() => contentEl) };
  const ports = createFakeChatPorts();
  const settingsSnapshot = ports.settings.getSettingsSnapshot();
  settingsSnapshot.enableAutoScroll = false;
  settingsSnapshot.enableAutoTitleGeneration = false;
  ports.settings.getSettingsSnapshot = () => settingsSnapshot;
  const deps = {
    plugin: {
      getOpenSessionById: jest.fn(async () => ({ titleSource: 'firstPrompt' })),
      renameSession: jest.fn(),
    },
    settings: ports.settings,
    sessions: ports.sessions,
    state,
    renderer: {
      addMessage: jest.fn(() => messageEl),
      refreshActionButtons: jest.fn(),
      removeMessage: jest.fn(),
    },
    streamController: {
      showThinkingIndicator: jest.fn(() => {
        expect(state.responseStartTime).not.toBeNull();
      }),
      hideThinkingIndicator: jest.fn(),
      handleStreamChunk: jest.fn(),
      appendText: jest.fn(),
      finalizeCurrentThinkingBlock: jest.fn(),
      finalizeCurrentTextBlock: jest.fn(),
    },
    selectionController: { getContext: jest.fn(() => null) },
    canvasSelectionController: { getContext: jest.fn(() => null) },
    openSessionController: { save: jest.fn(), generateFallbackTitle: jest.fn() },
    getInputEl: () => inputEl,
    getMessagesEl: () => ({
      ownerDocument: { defaultView: { setTimeout } },
      scrollTop: 0,
      scrollHeight: 0,
    }) as unknown as HTMLElement,
    getFileContextManager: () => null,
    getInlineContextManager: () => null,
    getImageContextManager: () => null,
    getExternalContextSelector: () => null,
    getTitleGenerationService: () => null,
    getInputContainerEl: () => ({}) as HTMLElement,
    generateId: () => `message-${++id}`,
    resetInputHeight: jest.fn(),
    getAgentService: () => currentService,
    ensureServiceInitialized,
    getSubagentManager: () => ({
      resetSpawnedCount: jest.fn(),
      resetStreamingState: jest.fn(),
      cancelAllActive: jest.fn(() => []),
    }),
  };

  return {
    controller: new InputController(deps as never),
    ensureServiceInitialized,
    events,
    inputEl,
    service,
    state,
  };
}

describe('InputController service and cancellation lifecycle', () => {
  it('initializes lazily before the first query and reuses the service on a second send', async () => {
    const { controller, ensureServiceInitialized, events, service } = createController();

    await controller.sendMessage({ content: 'first' });
    await controller.sendMessage({ content: 'second' });

    expect(ensureServiceInitialized).toHaveBeenCalledTimes(2);
    expect(service.query).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['init', 'prepare', 'query', 'init', 'prepare', 'query']);
  });

  it('reports accumulated assistant text after each processed text chunk', async () => {
    const { controller, service } = createController();
    (service.query as jest.Mock).mockImplementation(async function* () {
      yield { type: 'text', content: 'Hel' };
      yield { type: 'text', content: 'lo' };
      yield { type: 'text', content: ' world' };
    });
    let accumulated = '';
    (controller.deps.streamController.handleStreamChunk as jest.Mock).mockImplementation(
      async (chunk: { type: string; content: string }, message: { contentBlocks?: unknown[] }) => {
        if (chunk.type !== 'text') return;
        accumulated += chunk.content;
        message.contentBlocks = [{ type: 'text', content: accumulated }];
      },
    );
    const onAssistantText = jest.fn();

    await controller.sendMessage({ content: 'first', onAssistantText });

    expect(onAssistantText.mock.calls.map(call => call[0])).toEqual([
      'Hel',
      'Hello',
      'Hello world',
    ]);
  });

  it('sets cancellation state and restores the queue before cancelling the service', () => {
    const { controller, events, inputEl, service, state } = createController();
    const flushProjection = jest.spyOn(state, 'flushProjection');
    state.isStreaming = true;
    state.queuedMessages = [{
      id: 'queued-1',
      content: 'queued text',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-2',
      content: 'another queued text',
      editorContext: null,
      canvasContext: null,
    }];
    inputEl.value = 'current text';
    (service.cancel as jest.Mock).mockImplementation(() => {
      expect(state.cancelRequested).toBe(true);
      expect(state.queuedMessages).toEqual([]);
      expect(inputEl.value).toBe('queued text\n\nanother queued text\n\ncurrent text');
      events.push('cancel');
    });
    // Cancellation only targets a service that has already been initialized.
    void controller.deps.ensureServiceInitialized?.();
    events.length = 0;

    controller.cancelStreaming();

    expect(service.cancel).toHaveBeenCalledTimes(1);
    expect(flushProjection).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['cancel']);
  });

  it('steers an active turn with the queued snapshot and removes it from the queue', async () => {
    const { controller, ensureServiceInitialized, service, state } = createController();
    state.isStreaming = true;
    state.queuedMessages = [{
      id: 'queued-1',
      content: 'change direction',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-2',
      content: 'keep waiting',
      editorContext: null,
      canvasContext: null,
    }];
    await ensureServiceInitialized();

    controller.steerQueuedMessage('queued-1');

    expect(service.prepareTurn).toHaveBeenCalledWith(expect.objectContaining({
      text: 'change direction',
    }));
    expect(service.steer).toHaveBeenCalledWith(expect.objectContaining({
      displayContent: 'change direction',
      persistedContent: 'change direction',
    }));
    expect(state.queuedMessages.map(message => message.id)).toEqual(['queued-2']);
  });

  it('edits and discards one queued message without changing its siblings', () => {
    const { controller, inputEl, state } = createController();
    state.queuedMessages = [{
      id: 'queued-1',
      content: 'first',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-2',
      content: 'second',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-3',
      content: 'third',
      editorContext: null,
      canvasContext: null,
    }];

    controller.withdrawQueuedMessageToComposer('queued-2');
    controller.discardQueuedMessage('queued-3');

    expect(inputEl.value).toBe('second');
    expect(state.queuedMessages.map(message => message.id)).toEqual(['queued-1']);
  });

  it('reorders queued messages only when the requested order is complete', () => {
    const { controller, state } = createController();
    state.queuedMessages = [{
      id: 'queued-1',
      content: 'first',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-2',
      content: 'second',
      editorContext: null,
      canvasContext: null,
    }];

    expect(controller.reorderQueuedMessages(['queued-2', 'queued-1'])).toBe(true);
    expect(state.queuedMessages.map(message => message.id)).toEqual(['queued-2', 'queued-1']);

    expect(controller.reorderQueuedMessages(['queued-1'])).toBe(false);
    expect(state.queuedMessages.map(message => message.id)).toEqual(['queued-2', 'queued-1']);
  });

  it('processes queued messages in FIFO order', () => {
    jest.useFakeTimers();
    const { controller, state } = createController();
    const sendMessage = jest.spyOn(controller, 'sendMessage').mockResolvedValue();
    state.queuedMessages = [{
      id: 'queued-1',
      content: 'first',
      editorContext: null,
      canvasContext: null,
    }, {
      id: 'queued-2',
      content: 'second',
      editorContext: null,
      canvasContext: null,
    }];

    controller.processQueuedMessage();
    jest.runOnlyPendingTimers();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'first' }));
    expect(state.queuedMessages.map(message => message.id)).toEqual(['queued-2']);
    jest.useRealTimers();
  });
});
