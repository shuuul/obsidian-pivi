import { Notice } from 'obsidian';

import type { ChatMessage } from '@pivi/core';
import { findRewindContext } from '@/ui/chat/branchContext';
import { handleForkAll, handleForkRequest } from '@/ui/chat/tabs/tabFork';
import { updatePlanModeUI } from '@/ui/chat/tabs/tabPlanMode';
import type { TabData } from '@/ui/chat/tabs/types';
import { PiSettingsCoordinator } from '@pivi/pi-runtime/PiSettingsCoordinator';
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
      getSessionId: () => 'source-session',
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
      messages: messages.slice(0, 2),
      sourceSessionId: 'source-session',
      forkAtEntryId: 'uuid-u1',
      resumeAt: 'uuid-a0',
      sourceTitle: 'Source',
      forkAtUserMessage: 1,
      currentNote: 'note.md',
    }));
  });

  it('builds a fork request for the first persisted user message', async () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' } as ChatMessage,
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePlugin(), 'u1', callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      messages,
      sourceSessionId: 'source-session',
      forkAtEntryId: 'uuid-u1',
      resumeAt: 'uuid-u1',
      sourceTitle: 'Source',
      forkAtUserMessage: 1,
      currentNote: 'note.md',
    }));
  });

  it('builds a fork request for an assistant message state', async () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' } as ChatMessage,
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'uuid-a1' } as ChatMessage,
      { id: 'u2', role: 'user', content: 'two', timestamp: 3, userMessageId: 'uuid-u2' } as ChatMessage,
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePlugin(), 'a1', callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      messages: messages.slice(0, 2),
      sourceSessionId: 'source-session',
      forkAtEntryId: 'uuid-a1',
      resumeAt: 'uuid-a1',
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

describe('rewind checkpoint detection', () => {
  it('uses the user message parent entry as the rewind checkpoint', () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'entry-a0' } as ChatMessage,
      { id: 'u1', role: 'user', content: 'redo this', timestamp: 1, parentEntryId: 'entry-a0', userMessageId: 'entry-u1' } as ChatMessage,
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' } as ChatMessage,
    ];

    expect(findRewindContext(messages, 1)).toEqual({
      checkpointId: 'entry-a0',
      hasResponse: true,
    });
  });

  it('allows first-turn rewind to the root checkpoint', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1, parentEntryId: null, userMessageId: 'entry-u1' } as ChatMessage,
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' } as ChatMessage,
    ];

    expect(findRewindContext(messages, 0)).toEqual({
      checkpointId: null,
      hasResponse: true,
    });
  });
});

describe('updatePlanModeUI', () => {
  beforeEach(() => jest.clearAllMocks());

  it('commits plan mode, refreshes controls, and marks the input', () => {
    jest.spyOn(PiSettingsCoordinator, 'getSettingsSnapshot').mockReturnValue({
      model: 'model',
      thinkingBudget: 'auto',
      thinkingLevel: 'medium',
      permissionMode: 'normal',
    });
    const commitSpy = jest.spyOn(PiSettingsCoordinator, 'commitSettingsSnapshot').mockImplementation();
    const plugin = makePlugin();
    const tab = makeTab([]);

    updatePlanModeUI(tab, plugin, 'plan');

    expect(commitSpy).toHaveBeenCalledWith(plugin.settings, expect.objectContaining({ permissionMode: 'plan' }));
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(tab.ui.permissionToggle?.updateDisplay).toHaveBeenCalled();
    expect(tab.dom.inputWrapper.toggleClass).toHaveBeenCalledWith('pivi-input-plan-mode', true);
  });
});
