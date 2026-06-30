import { SessionController } from '../../../../src/features/chat/controllers/SessionController';
import type { OpenSessionState } from '../../../../src/core/types';
import { ChatState } from '../../../../src/features/chat/state/ChatState';

function createController(openSession?: Partial<OpenSessionState>) {
  const state = new ChatState();
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
    getWelcomeEl: () => document.createElement('div'),
    setWelcomeEl: jest.fn(),
    getMessagesEl: () => document.createElement('div'),
    getInputEl: () => document.createElement('textarea') as never,
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
