import { Notice } from 'obsidian';

import { AgentServices } from '../../../../src/core/agent/AgentServices';
import { AgentSettingsCoordinator } from '../../../../src/core/agent/AgentSettingsCoordinator';
import type { ChatMessage } from '../../../../src/core/types';
import { handleForkAll, handleForkRequest } from '../../../../src/features/chat/tabs/tabFork';
import { updatePlanModeUI } from '../../../../src/features/chat/tabs/tabPlanMode';
import type { TabData } from '../../../../src/features/chat/tabs/types';
import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';

function makeTab(messages: ChatMessage[], overrides: Partial<TabData> = {}): TabData {
  return {
    id: 'tab-1',
    lifecycleState: 'bound_active',
    draftModel: null,
    openSessionId: 'open-1',
    sessionFile: 'source.jsonl',
    leafId: null,
    service: {
      getCapabilities: () => ({ supportsFork: true, supportsPlanMode: true }),
      resolveSessionIdForFork: () => 'source-session',
    } as never,
    serviceInitialized: true,
    state: { messages, isStreaming: false } as never,
    controllers: {} as never,
    services: {} as never,
    ui: { permissionToggle: { updateDisplay: jest.fn() } } as never,
    dom: { inputWrapper: { toggleClass: jest.fn() } } as never,
    renderer: null,
    ...overrides,
  };
}

function makePlugin() {
  const plugin = createMockPiviPluginStub();
  Object.assign(plugin, {
    getOpenSessionSync: jest.fn(() => ({ id: 'open-1', title: 'Source', currentNote: 'note.md', sessionFile: 'source.jsonl' })),
    saveSettings: jest.fn(async () => {}),
  });
  return asPiviPlugin(plugin);
}

describe('tab fork guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a fork request for a user message with an assistant resume target', async () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'uuid-a0' } as ChatMessage,
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' } as ChatMessage,
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'uuid-a1' } as ChatMessage,
      { id: 'u2', role: 'user', content: 'two', timestamp: 3, userMessageId: 'uuid-u2' } as ChatMessage,
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePlugin(), 'u1', callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      messages: messages.slice(0, 1),
      sourceSessionId: 'source-session',
      forkAtEntryId: 'u1',
      resumeAt: 'uuid-a0',
      sourceTitle: 'Source',
      forkAtUserMessage: 1,
      currentNote: 'note.md',
    }));
  });

  it('does not fork when the selected user message has no persisted uuid', async () => {
    const callback = jest.fn(async () => {});

    await handleForkRequest(
      makeTab([{ id: 'u1', role: 'user', content: 'one', timestamp: 1 } as ChatMessage]),
      makePlugin(),
      'u1',
      callback,
    );

    expect(callback).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('Cannot fork: missing message identifiers');
  });

  it('does not fork all when no assistant message has a persisted uuid', async () => {
    const callback = jest.fn(async () => {});

    await handleForkAll(
      makeTab([
        { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' } as ChatMessage,
        { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2 } as ChatMessage,
      ]),
      makePlugin(),
      callback,
    );

    expect(callback).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('assistant'));
  });
});

describe('updatePlanModeUI', () => {
  beforeEach(() => jest.clearAllMocks());

  it('commits plan mode, refreshes controls, and marks the input only when supported', () => {
    jest.spyOn(AgentSettingsCoordinator, 'getAgentSettingsSnapshot').mockReturnValue({
      model: 'model',
      thinkingBudget: 'auto',
      thinkingLevel: 'medium',
      permissionMode: 'normal',
    });
    jest.spyOn(AgentServices, 'getChatUIConfig').mockReturnValue({
      applyPermissionMode: (mode: string, snapshot: Record<string, unknown>) => { snapshot.permissionMode = mode; },
    } as never);
    const commitSpy = jest.spyOn(AgentSettingsCoordinator, 'commitAgentSettingsSnapshot').mockImplementation();
    const plugin = makePlugin();
    const tab = makeTab([]);

    updatePlanModeUI(tab, plugin, 'plan');

    expect(commitSpy).toHaveBeenCalledWith(plugin.settings, expect.objectContaining({ permissionMode: 'plan' }));
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(tab.ui.permissionToggle?.updateDisplay).toHaveBeenCalled();
    expect(tab.dom.inputWrapper.toggleClass).toHaveBeenCalledWith('pivi-input-plan-mode', true);

    const unsupportedTab = makeTab([], { service: { getCapabilities: () => ({ supportsFork: true, supportsPlanMode: false }) } as never });
    updatePlanModeUI(unsupportedTab, plugin, 'plan');
    expect(unsupportedTab.dom.inputWrapper.toggleClass).toHaveBeenCalledWith('pivi-input-plan-mode', false);
  });
});
