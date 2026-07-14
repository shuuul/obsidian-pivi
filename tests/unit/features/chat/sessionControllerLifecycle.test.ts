import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';

import { SessionController } from '@/ui/chat/controllers/SessionController';
import { ChatState } from '@/ui/chat/state/ChatState';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';

const MSG = { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };

function createFixture(openSession?: Partial<OpenSessionState>) {
  const state = new ChatState();
  const element = {
    empty: jest.fn(),
    createDiv: jest.fn(() => element),
    createEl: jest.fn(() => element),
    addClass: jest.fn(),
    removeClass: jest.fn(),
    setText: jest.fn(),
  } as unknown as HTMLElement;
  const inputEl = { value: 'draft', focus: jest.fn() };
  const externalContextSelector = { resetForSession: jest.fn() };
  const fileCtx = {
    resetForNewSession: jest.fn(),
    autoAttachActiveFile: jest.fn(),
    resetForLoadedSession: jest.fn(),
    setCurrentNote: jest.fn(),
    getCurrentNotePath: jest.fn(() => 'note.md'),
  };
  const inlineCtx = {
    resetForNewSession: jest.fn(),
    resetForLoadedSession: jest.fn(),
  };
  const subagentManager = { orphanAllActive: jest.fn(), clear: jest.fn() };
  const agentService = createFakePiChatService({ sessionId: 'agent-sid' });
  agentService.getSessionStateUpdates = jest.fn(() => ({
    sessionFile: '.pivi/sessions/agent.jsonl',
  }));
  const ensureServiceForSession = jest.fn(async () => undefined);
  const callbacks = {
    onNewSession: jest.fn(),
    onSessionLoaded: jest.fn(),
    onSessionSwitched: jest.fn(),
  };

  const conv: OpenSessionState = {
    id: 'conv-1',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    sessionId: 'conv-1',
    sessionFile: '.pivi/sessions/test.jsonl',
    leafId: 'leaf-a',
    messages: [MSG],
    ...openSession,
  };

  const ports = createFakeChatPorts({
    sessions: {
      findOpenSession: jest.fn(() => conv),
      getOpenSession: jest.fn(async (id: string) => (id === conv.id ? conv : null)),
      createSession: jest.fn(async () => ({ ...conv, id: 'new-conv' })),
      updateSession: jest.fn(async () => undefined),
      deleteSession: jest.fn(async () => undefined),
    },
  });
  const settingsSnapshot = ports.settings.getSettingsSnapshot();
  settingsSnapshot.externalReadDirectories = ['/settings/pin'];
  ports.settings.getSettingsSnapshot = jest.fn(() => settingsSnapshot);
  const sessions = ports.sessions;
  const resetStreamingState = jest.fn();

  const controller = new SessionController(
    {
      settings: ports.settings,
      sessions,
      state,
      subagentManager: subagentManager as never,
      getMessagesEl: () => element,
      getInputEl: () => inputEl as never,
      getFileContextManager: () => fileCtx as never,
      getInlineContextManager: () => inlineCtx as never,
      getImageContextManager: () => null,
      getExternalContextSelector: () => externalContextSelector as never,
      clearQueuedMessage: jest.fn(),
      resetStreamingState,
      getAgentService: () => agentService,
      ensureServiceForSession,
      dismissPendingInlinePrompts: jest.fn(),
    },
    callbacks,
  );

  return {
    controller,
    state,
    sessions,
    conv,
    agentService,
    subagentManager,
    callbacks,
    ensureServiceForSession,
    fileCtx,
    inlineCtx,
    externalContextSelector,
    element,
    inputEl,
    resetStreamingState,
  };
}

describe('SessionController.createNew', () => {
  it('resets to entry point and notifies onNewSession', async () => {
    const {
      controller, state, agentService, subagentManager, callbacks, element, resetStreamingState,
    } = createFixture();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [MSG];

    await controller.createNew();

    expect(state.currentOpenSessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(subagentManager.orphanAllActive).toHaveBeenCalled();
    expect(subagentManager.clear).toHaveBeenCalled();
    expect(resetStreamingState).toHaveBeenCalled();
    expect(agentService.syncSession).toHaveBeenCalledWith(null, ['/settings/pin']);
    expect(element.empty).toHaveBeenCalled();
    expect(state.welcomeGreeting).toEqual(expect.any(String));
    expect(callbacks.onNewSession).toHaveBeenCalled();
  });

  it('no-ops while streaming unless force cancels the service', async () => {
    const { controller, state, agentService, callbacks } = createFixture();
    state.isStreaming = true;
    state.currentOpenSessionId = 'conv-1';
    state.messages = [MSG];

    await controller.createNew();
    expect(callbacks.onNewSession).not.toHaveBeenCalled();
    expect(agentService.cancel).not.toHaveBeenCalled();

    await controller.createNew({ force: true });
    expect(agentService.cancel).toHaveBeenCalled();
    expect(state.isStreaming).toBe(false);
    expect(callbacks.onNewSession).toHaveBeenCalled();
  });

  it('saves the current session before reset when it has messages', async () => {
    const { controller, state, sessions } = createFixture();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [MSG];

    await controller.createNew();

    expect(sessions.updateSession).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ messages: [MSG] }),
    );
    expect(state.currentOpenSessionId).toBeNull();
  });
});

describe('SessionController.loadActive', () => {
  it('enters welcome state when there is no open session', async () => {
    const {
      controller, state, agentService, callbacks, fileCtx, inlineCtx, externalContextSelector,
    } = createFixture();
    state.currentOpenSessionId = null;

    await controller.loadActive();

    expect(agentService.syncSession).toHaveBeenCalledWith(null, ['/settings/pin']);
    expect(state.welcomeGreeting).toEqual(expect.any(String));
    expect(fileCtx.resetForNewSession).toHaveBeenCalled();
    expect(inlineCtx.resetForNewSession).toHaveBeenCalled();
    expect(externalContextSelector.resetForSession).toHaveBeenCalledWith(['/settings/pin']);
    expect(callbacks.onSessionLoaded).toHaveBeenCalled();
  });

  it('restores an open session via ensureServiceForSession', async () => {
    const {
      controller, state, conv, ensureServiceForSession, callbacks, externalContextSelector,
      resetStreamingState,
    } = createFixture();
    state.currentOpenSessionId = 'conv-1';

    await controller.loadActive();

    expect(ensureServiceForSession).toHaveBeenCalledWith(conv);
    expect(resetStreamingState).toHaveBeenCalled();
    expect(state.messages).toEqual([MSG]);
    expect(state.currentOpenSessionId).toBe('conv-1');
    expect(externalContextSelector.resetForSession).toHaveBeenCalledWith(['/settings/pin']);
    expect(callbacks.onSessionLoaded).toHaveBeenCalled();
  });
});

describe('SessionController.switchTo', () => {
  it('saves, switches, restores, and notifies', async () => {
    const {
      controller, state, sessions, conv, ensureServiceForSession, callbacks, subagentManager,
      resetStreamingState,
    } = createFixture();
    state.currentOpenSessionId = 'other';
    state.messages = [{ id: 'm0', role: 'user', content: 'prev', timestamp: 0 }];

    await controller.switchTo('conv-1');

    expect(sessions.updateSession).toHaveBeenCalled();
    expect(sessions.getOpenSession).toHaveBeenCalledWith('conv-1');
    expect(subagentManager.orphanAllActive).toHaveBeenCalled();
    expect(resetStreamingState).toHaveBeenCalled();
    expect(ensureServiceForSession).toHaveBeenCalledWith(conv);
    expect(state.currentOpenSessionId).toBe('conv-1');
    expect(state.messages).toEqual([MSG]);
    expect(callbacks.onSessionSwitched).toHaveBeenCalled();
    expect(state.isSwitchingSession).toBe(false);
  });

  it('skips when the same open session is already shown with messages', async () => {
    const { controller, state, sessions, callbacks } = createFixture();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [MSG];

    await controller.switchTo('conv-1');

    expect(sessions.getOpenSession).not.toHaveBeenCalled();
    expect(callbacks.onSessionSwitched).not.toHaveBeenCalled();
  });

  it('skips while streaming or already switching', async () => {
    const { controller, state, sessions } = createFixture();
    state.currentOpenSessionId = 'other';
    state.isStreaming = true;
    await controller.switchTo('conv-1');
    expect(sessions.getOpenSession).not.toHaveBeenCalled();

    state.isStreaming = false;
    state.isSwitchingSession = true;
    await controller.switchTo('conv-1');
    expect(sessions.getOpenSession).not.toHaveBeenCalled();
  });

  it('clears switching flag when the session port returns null', async () => {
    const { controller, state, sessions, callbacks } = createFixture();
    state.currentOpenSessionId = 'other';
    jest.mocked(sessions.getOpenSession).mockResolvedValueOnce(null);

    await controller.switchTo('conv-1');

    expect(callbacks.onSessionSwitched).not.toHaveBeenCalled();
    expect(state.isSwitchingSession).toBe(false);
  });
});

describe('SessionController.save', () => {
  it('no-ops at entry point with no messages', async () => {
    const { controller, state, sessions } = createFixture();
    state.currentOpenSessionId = null;
    state.messages = [];

    await controller.save();

    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(sessions.updateSession).not.toHaveBeenCalled();
  });

  it('creates an open session then updates when entry point has messages', async () => {
    const { controller, state, sessions } = createFixture();
    state.currentOpenSessionId = null;
    state.messages = [MSG];

    await controller.save();

    expect(sessions.createSession).toHaveBeenCalledWith({
      sessionId: 'agent-sid',
      sessionFile: '.pivi/sessions/agent.jsonl',
    });
    expect(state.currentOpenSessionId).toBe('new-conv');
    expect(sessions.updateSession).toHaveBeenCalledWith(
      'new-conv',
      expect.objectContaining({
        messages: [MSG],
        currentNote: 'note.md',
      }),
    );
    expect(state.hasPendingSessionSave).toBe(false);
  });

  it('updates an existing session and clears pending save', async () => {
    const { controller, state, sessions } = createFixture();
    state.currentOpenSessionId = 'conv-1';
    state.messages = [MSG];
    state.usage = { inputTokens: 1, outputTokens: 2 } as never;
    state.hasPendingSessionSave = true;

    await controller.save();

    expect(sessions.createSession).not.toHaveBeenCalled();
    expect(sessions.updateSession).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        messages: [MSG],
        usage: { inputTokens: 1, outputTokens: 2 },
        currentNote: 'note.md',
      }),
    );
    expect(state.hasPendingSessionSave).toBe(false);
  });
});

describe('SessionController.initializeWelcome', () => {
  it('sets welcomeGreeting and resets file/inline context', () => {
    const { controller, state, fileCtx, inlineCtx } = createFixture();

    controller.initializeWelcome();

    expect(fileCtx.resetForNewSession).toHaveBeenCalled();
    expect(fileCtx.autoAttachActiveFile).toHaveBeenCalled();
    expect(inlineCtx.resetForNewSession).toHaveBeenCalled();
    expect(state.welcomeGreeting).toEqual(expect.any(String));
    expect(state.welcomeGreeting!.length).toBeGreaterThan(0);
  });
});
