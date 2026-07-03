import { SessionController } from '@/ui/chat/controllers/SessionController';
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import { ChatState } from '@/ui/chat/state/ChatState';

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

  it('skips when the same openSession is already shown', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string, leafId?: string | null): boolean })
      .shouldSkipSwitchTo('conv-1', 'leaf-a');

    expect(skip).toBe(true);
  });

  it('ignores legacy leaf requests when the same openSession is already shown', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string, leafId?: string | null): boolean })
      .shouldSkipSwitchTo('conv-1', 'leaf-b');

    expect(skip).toBe(true);
  });
});
