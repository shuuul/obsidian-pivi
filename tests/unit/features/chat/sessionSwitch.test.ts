import { SessionController } from '@/ui/chat/controllers/SessionController';
import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import { ChatState } from '@/ui/chat/state/ChatState';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';

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
  const externalContextSelector = {
    resetForSession: jest.fn(),
  };
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

  const ports = createFakeChatPorts({
    sessions: {
      findOpenSession: jest.fn(() => conv),
      getOpenSession: jest.fn(async () => conv),
      updateSession: jest.fn(async () => undefined),
      deleteSession: jest.fn(async () => undefined),
    },
  });
  const settingsSnapshot = ports.settings.getSettingsSnapshot();
  settingsSnapshot.externalReadDirectories = ['/settings/pin'];
  ports.settings.getSettingsSnapshot = jest.fn(() => settingsSnapshot);
  const sessions = ports.sessions;

  const controller = new SessionController({
    settings: ports.settings,
    sessions,
    state,
    subagentManager: { orphanAllActive: jest.fn(), clear: jest.fn() } as never,
    getMessagesEl: () => element,
    getInputEl: () => inputEl as never,
    getFileContextManager: () => null,
    getInlineContextManager: () => null,
    getImageContextManager: () => null,
    getExternalContextSelector: () => externalContextSelector as never,
    clearQueuedMessage: jest.fn(),
    getAgentService: () => null,
    dismissPendingInlinePrompts: jest.fn(),
  });

  return { controller, state, sessions, conv, externalContextSelector };
}

describe('SessionController.shouldSkipSwitchTo', () => {
  it('re-loads the same openSession when tab messages are empty', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string): boolean })
      .shouldSkipSwitchTo('conv-1');

    expect(skip).toBe(false);
  });

  it('skips when the same openSession is already shown', () => {
    const { controller, state } = createController();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }];

    const skip = (controller as unknown as { shouldSkipSwitchTo(id: string): boolean })
      .shouldSkipSwitchTo('conv-1');

    expect(skip).toBe(true);
  });

  it('discards session-only roots and resets to settings pins when restoring a session', () => {
    const { controller, conv, externalContextSelector } = createController({
      externalContextPaths: ['/old/session-only-root'],
    });

    (controller as unknown as {
      restoreOpenSession(openSession: OpenSessionState): void;
    }).restoreOpenSession(conv);

    expect(externalContextSelector.resetForSession).toHaveBeenCalledWith(['/settings/pin']);
    expect(externalContextSelector.resetForSession).not.toHaveBeenCalledWith(['/old/session-only-root']);
  });
});
