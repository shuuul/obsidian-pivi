jest.mock('../../../../src/features/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn(async () => true),
}));

import { SessionController } from '../../../../src/features/chat/controllers/SessionController';
import type { OpenSessionState } from '../../../../src/pi/types';
import { ChatState } from '../../../../src/features/chat/state/ChatState';

function createController(openSession?: Partial<OpenSessionState>) {
  const state = new ChatState();
  const element = {
    empty: jest.fn(),
    createDiv: jest.fn(() => element),
    createEl: jest.fn(() => element),
    addClass: jest.fn(),
    removeClass: jest.fn(),
    setText: jest.fn(),
  } as unknown as HTMLElement;
  const inputEl = { value: '', focus: jest.fn() };
  const conv: OpenSessionState = {
    id: 'conv-1',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    sessionId: 'conv-1',
    sessionFile: '.pivi/sessions/test.jsonl',
    leafId: 'leaf-a',
    messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }],
    ...openSession,
  };

  const plugin = {
    app: {},
    settings: { enableAutoScroll: true, persistentExternalContextPaths: [] },
    getOpenSessionSync: jest.fn(() => conv),
    switchSession: jest.fn(async () => conv),
    updateSession: jest.fn(),
    deleteSession: jest.fn(async () => undefined),
  };

  const controller = new SessionController({
    plugin: plugin as never,
    state,
    renderer: { renderMessages: jest.fn() } as never,
    subagentManager: { orphanAllActive: jest.fn(), clear: jest.fn() } as never,
    getHistoryDropdown: () => null,
    getWelcomeEl: () => element,
    setWelcomeEl: jest.fn(),
    getMessagesEl: () => element,
    getInputEl: () => inputEl as never,
    getFileContextManager: () => null,
    getInlineContextManager: () => null,
    getImageContextManager: () => null,
    getMcpServerSelector: () => null,
    getExternalContextSelector: () => null,
    clearQueuedMessage: jest.fn(),
    getTitleGenerationService: () => null,
    getStatusPanel: () => null,
    getAgentService: () => null,
    dismissPendingInlinePrompts: jest.fn(),
  });

  return { controller, state, plugin, conv };
}

describe('SessionController.shouldSkipSwitchTo', () => {
  it('re-loads the same openSession when tab messages are empty', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string, leafId?: string | null): boolean })
      .shouldSkipSwitchTo('conv-1', undefined);

    expect(skip).toBe(false);
  });

  it('skips when the same openSession and leaf are already shown', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string, leafId?: string | null): boolean })
      .shouldSkipSwitchTo('conv-1', 'leaf-a');

    expect(skip).toBe(true);
  });

  it('re-loads when switching to a different branch leaf', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string, leafId?: string | null): boolean })
      .shouldSkipSwitchTo('conv-1', 'leaf-b');

    expect(skip).toBe(false);
  });
});

describe('SessionController history deletion', () => {
  it('does not silently ignore delete clicks while another session is streaming', async () => {
    const { controller, state, plugin } = createController();
    state.currentOpenSessionId = 'other-session';
    state.isStreaming = true;
    const onRerender = jest.fn();

    await (controller as unknown as {
      deleteHistorySession(id: string, options: { onRerender: () => void }): Promise<void>;
    }).deleteHistorySession('conv-1', { onRerender });

    expect(plugin.deleteSession).toHaveBeenCalledWith('conv-1');
    expect(onRerender).toHaveBeenCalled();
  });
});

describe('SessionController rewind', () => {
  it('switches to the JSONL leaf and hydrates messages instead of trimming UI state', async () => {
    const hydratedMessages = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'entry-a0' },
    ] as OpenSessionState['messages'];
    const { controller, state, plugin } = createController({
      leafId: 'entry-a0',
      messages: hydratedMessages,
    });
    const runtime = {
      rewind: jest.fn(async () => ({ canRewind: true, leafId: 'entry-a0' })),
      buildSessionUpdates: jest.fn(() => ({ updates: { leafId: 'entry-a0', sessionId: 'conv-1' } })),
      consumeSessionInvalidation: jest.fn(() => false),
      syncOpenSessionState: jest.fn(),
    };
    (controller as unknown as { deps: { getAgentService: () => typeof runtime } }).deps.getAgentService = () => runtime;

    state.currentOpenSessionId = 'conv-1';
    state.messages = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'entry-a0' },
      { id: 'u1', role: 'user', content: 'redo this', displayContent: 'redo this', timestamp: 1, parentEntryId: 'entry-a0', userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ];

    await controller.rewind('u1');

    expect(runtime.rewind).toHaveBeenCalledWith('entry-a0');
    expect(plugin.switchSession).toHaveBeenCalledWith('conv-1', 'entry-a0');
    expect(state.messages).toEqual(hydratedMessages);
    expect(plugin.updateSession).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        messages: hydratedMessages,
        leafId: 'entry-a0',
      }),
    );
  });
});
