import { Notice } from 'obsidian';

import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { findRedoContext, findRewindContext } from '@/ui/chat/branchContext';
import { ChatState } from '@/ui/chat/state/ChatState';
import { handleForkAll, handleForkRequest } from '@/ui/chat/tabs/tabFork';
import { handleRedoRequest, resolveRedoTurnContext } from '@/ui/chat/tabs/tabRedo';
import type { TabData } from '@/ui/chat/tabs/types';
import { confirm } from '@/ui/shared/modals/ConfirmModal';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';
import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';

jest.mock('@/ui/shared/modals/ConfirmModal', () => ({
  confirm: jest.fn(async () => true),
  confirmDelete: jest.fn(async () => true),
}));

const mockConfirm = confirm as jest.MockedFunction<typeof confirm>;

function makeTab(messages: ChatMessage[], overrides: Partial<TabData> = {}): TabData {
  return {
    id: 'tab-1',
    lifecycleState: 'bound_active',
    draftModel: null,
    draftTitle: null,
    openSessionId: 'open-1',
    sessionFile: 'source.jsonl',
    leafId: null,
    service: {
      getSessionId: () => 'source-session',
    } as never,
    isArchived: false,
    serviceInitialized: true,
    state: { messages, isStreaming: false } as never,
    controllers: {} as never,
    services: {} as never,
    ui: {} as never,
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

function makePorts() {
  return createFakeChatPorts({
    sessions: {
      findOpenSession: jest.fn(() => ({
        id: 'open-1',
        title: 'Source',
        currentNote: 'note.md',
        sessionFile: 'source.jsonl',
      }) as never),
    },
  });
}

describe('tab fork guards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a fork request for a user message with an assistant resume target', async () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'uuid-a0' },
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'uuid-a1' },
      { id: 'u2', role: 'user', content: 'two', timestamp: 3, userMessageId: 'uuid-u2' },
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePorts().sessions, 'u1', callback);

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
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' },
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePorts().sessions, 'u1', callback);

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
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'uuid-a1' },
      { id: 'u2', role: 'user', content: 'two', timestamp: 3, userMessageId: 'uuid-u2' },
    ];
    const callback = jest.fn(async () => {});

    await handleForkRequest(makeTab(messages), makePorts().sessions, 'a1', callback);

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

  it('keeps the durable user ordinal when older messages are not hydrated', async () => {
    const messages: ChatMessage[] = [
      { id: 'u51', role: 'user', content: 'visible', timestamp: 1, userMessageId: 'uuid-u51' },
      { id: 'a51', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'uuid-a51' },
    ];
    const tab = makeTab(messages);
    Object.assign(tab.state, { olderUserMessageCount: 50 });
    const callback = jest.fn(async () => {});

    await handleForkRequest(tab, makePorts().sessions, 'a51', callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      forkAtUserMessage: 51,
    }));
  });

  it('does not fork when the selected user message has no persisted uuid', async () => {
    const callback = jest.fn(async () => {});

    await handleForkRequest(
      makeTab([{ id: 'u1', role: 'user', content: 'one', timestamp: 1 }]),
      makePorts().sessions,
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
        { id: 'u1', role: 'user', content: 'one', timestamp: 1, userMessageId: 'uuid-u1' },
        { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2 },
      ]),
      makePorts().sessions,
      callback,
    );

    expect(callback).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining('assistant'));
  });
});

describe('rewind checkpoint detection', () => {
  it('uses the user message parent entry as the rewind checkpoint', () => {
    const messages: ChatMessage[] = [
      { id: 'a0', role: 'assistant', content: 'previous', timestamp: 0, assistantMessageId: 'entry-a0' },
      { id: 'u1', role: 'user', content: 'redo this', timestamp: 1, parentEntryId: 'entry-a0', userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ];

    expect(findRewindContext(messages, 1)).toEqual({
      checkpointId: 'entry-a0',
      hasResponse: true,
    });
  });

  it('allows first-turn rewind to the root checkpoint', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1, parentEntryId: null, userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ];

    expect(findRewindContext(messages, 0)).toEqual({
      checkpointId: null,
      hasResponse: true,
    });
  });

  it('resolves redo context from an assistant response to the preceding user turn', () => {
    const messages: ChatMessage[] = [
      { id: 'u0', role: 'user', content: 'previous', timestamp: 0, parentEntryId: null, userMessageId: 'entry-u0' },
      { id: 'a0', role: 'assistant', content: 'previous answer', timestamp: 1, assistantMessageId: 'entry-a0' },
      { id: 'u1', role: 'user', content: 'redo this', timestamp: 2, parentEntryId: 'entry-a0', userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 3, assistantMessageId: 'entry-a1' },
      { id: 'u2', role: 'user', content: 'later', timestamp: 4, parentEntryId: 'entry-a1', userMessageId: 'entry-u2' },
    ];

    expect(findRedoContext(messages, 3)).toEqual({
      userIndex: 2,
      checkpointId: 'entry-a0',
    });
  });

  it('preserves the structured request snapshot for redo instead of recapturing visible text only', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Ask @server MCP about [[Project]]',
        displayContent: 'Ask @server about [[Project]]',
        timestamp: 1,
        parentEntryId: null,
        userMessageId: 'entry-u1',
        images: [{
          id: 'img-1',
          name: 'diagram.png',
          mediaType: 'image/png',
          data: 'abc123',
          size: 6,
          source: 'paste',
        }],
        turnRequest: {
          text: 'Ask @server MCP about [[Project]]',
          currentNotePath: 'Project.md',
          attachedFilePaths: ['Project.md'],
          externalContextPaths: ['/tmp/context'],
          enabledMcpServers: ['server'],
        },
      },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ];

    const redoTurn = resolveRedoTurnContext(messages, 'a1');
    const [firstMessage] = messages;
    expect(firstMessage).toBeDefined();
    if (!firstMessage) throw new Error('Expected the fixture to include a user message');

    expect(redoTurn).toEqual(expect.objectContaining({
      userIndex: 0,
      checkpointId: null,
      displayContent: 'Ask @server about [[Project]]',
      images: firstMessage.images,
    }));
    expect(redoTurn?.turnRequest).toEqual(expect.objectContaining({
      text: 'Ask @server MCP about [[Project]]',
      currentNotePath: 'Project.md',
      attachedFilePaths: ['Project.md'],
      externalContextPaths: ['/tmp/context'],
      enabledMcpServers: new Set(['server']),
      images: firstMessage.images,
    }));
  });
});

describe('redo handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
  });

  function makeRedoTab(messages: ChatMessage[], service: { rewind: jest.Mock }): TabData {
    return makeTab(messages, {
      service: service as never,
      serviceInitialized: true,
      openSessionId: null,
      leafId: 'entry-a1',
      state: {
        messages,
        isStreaming: false,
        usage: { stale: true },
        currentTodos: [{ content: 'old todo', status: 'pending' }],
        clearMaps: jest.fn(),
      } as never,
      controllers: {
        streamController: { resetStreamingState: jest.fn() },
        openSessionController: {
          save: jest.fn(async () => {}),
          getGreeting: jest.fn(() => 'hello'),
          updateWelcomeVisibility: jest.fn(),
        },
        inputController: { sendMessage: jest.fn(async () => {}) },
      } as never,
      services: {
        subagentManager: {
          orphanAllActive: jest.fn(),
          clear: jest.fn(),
        },
      } as never,
      renderer: { renderMessages: jest.fn() } as never,
    });
  }

  it('rewinds only to the target turn checkpoint and resubmits the original turn request', async () => {
    const messages: ChatMessage[] = [
      { id: 'u0', role: 'user', content: 'previous', timestamp: 0, parentEntryId: null, userMessageId: 'entry-u0' },
      { id: 'a0', role: 'assistant', content: 'previous answer', timestamp: 1, assistantMessageId: 'entry-a0' },
      {
        id: 'u1',
        role: 'user',
        content: 'Ask @server MCP',
        displayContent: 'Ask @server',
        timestamp: 2,
        parentEntryId: 'entry-a0',
        userMessageId: 'entry-u1',
        turnRequest: {
          text: 'Ask @server MCP',
          attachedFilePaths: ['A.md'],
          enabledMcpServers: ['server'],
        },
      },
      { id: 'a1', role: 'assistant', content: 'target answer', timestamp: 3, assistantMessageId: 'entry-a1' },
      { id: 'u2', role: 'user', content: 'later', timestamp: 4, parentEntryId: 'entry-a1', userMessageId: 'entry-u2' },
      { id: 'a2', role: 'assistant', content: 'later answer', timestamp: 5, assistantMessageId: 'entry-a2' },
    ];
    const service = {
      rewind: jest.fn(async () => ({ canRewind: true, leafId: 'entry-a0' })),
    };
    const tab = makeRedoTab(messages, service);

    await handleRedoRequest(tab, makePlugin(), makePorts(), 'a1');

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.anything(),
      'Redoing this response will discard all later messages in this chat. Continue?',
      'Redo and discard',
    );
    expect(service.rewind).toHaveBeenCalledWith('entry-a0');
    expect(tab.leafId).toBe('entry-a0');
    expect(tab.state.messages).toEqual(messages.slice(0, 2));
    expect(tab.controllers.openSessionController?.save).toHaveBeenCalledWith(false);
    expect(tab.controllers.inputController?.sendMessage).toHaveBeenCalledWith({
      content: 'Ask @server',
      images: undefined,
      turnRequestOverride: expect.objectContaining({
        text: 'Ask @server MCP',
        attachedFilePaths: ['A.md'],
        enabledMcpServers: new Set(['server']),
      }),
    });
  });

  it('keeps page-outside counts when redoing the first hydrated turn', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'u2451',
        role: 'user',
        content: 'redo visible turn',
        timestamp: 1,
        parentEntryId: 'entry-a2450',
        userMessageId: 'entry-u2451',
      },
      { id: 'a2451', role: 'assistant', content: 'target', timestamp: 2, assistantMessageId: 'entry-a2451' },
      { id: 'u2452', role: 'user', content: 'later', timestamp: 3, parentEntryId: 'entry-a2451', userMessageId: 'entry-u2452' },
      { id: 'a2452', role: 'assistant', content: 'later answer', timestamp: 4, assistantMessageId: 'entry-a2452' },
    ];
    const service = {
      rewind: jest.fn(async () => ({ canRewind: true, leafId: 'entry-a2450' })),
    };
    const tab = makeRedoTab(messages, service);
    const state = new ChatState();
    state.olderMessageCount = 4_900;
    state.olderUserMessageCount = 2_450;
    state.messages = messages;
    state.totalMessageCount = 4_904;
    state.hasOlderMessages = true;
    tab.state = state;

    await handleRedoRequest(tab, makePlugin(), makePorts(), 'a2451');

    expect(service.rewind).toHaveBeenCalledWith('entry-a2450');
    expect(state.messages).toEqual([]);
    expect(state.hasOlderMessages).toBe(true);
    expect(state.totalMessageCount).toBe(4_900);
    expect(state.olderMessageCount).toBe(4_900);
    expect(state.olderUserMessageCount).toBe(2_450);
  });

  it('does not rewind a middle turn when the destructive redo confirmation is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'redo this', timestamp: 1, parentEntryId: null, userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'target answer', timestamp: 2, assistantMessageId: 'entry-a1' },
      { id: 'u2', role: 'user', content: 'later', timestamp: 3, parentEntryId: 'entry-a1', userMessageId: 'entry-u2' },
    ];
    const service = { rewind: jest.fn() };
    const tab = makeRedoTab(messages, service);

    await handleRedoRequest(tab, makePlugin(), makePorts(), 'a1');

    expect(mockConfirm).toHaveBeenCalled();
    expect(service.rewind).not.toHaveBeenCalled();
    expect(tab.controllers.inputController?.sendMessage).not.toHaveBeenCalled();
    expect(tab.state.messages).toEqual(messages);
  });

  it('does not ask for confirmation when redoing the latest assistant response', async () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'redo this', timestamp: 1, parentEntryId: null, userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'target answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ];
    const service = {
      rewind: jest.fn(async () => ({ canRewind: true, leafId: null })),
    };
    const tab = makeRedoTab(messages, service);

    await handleRedoRequest(tab, makePlugin(), makePorts(), 'a1');

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(service.rewind).toHaveBeenCalledWith(null);
    expect(tab.controllers.inputController?.sendMessage).toHaveBeenCalled();
  });

  it('does not redo while a turn is already streaming', async () => {
    const service = { rewind: jest.fn() };
    const tab = makeRedoTab([
      { id: 'u1', role: 'user', content: 'one', timestamp: 1, parentEntryId: null, userMessageId: 'entry-u1' },
      { id: 'a1', role: 'assistant', content: 'answer', timestamp: 2, assistantMessageId: 'entry-a1' },
    ], service);
    tab.state.isStreaming = true;

    await handleRedoRequest(tab, makePlugin(), makePorts(), 'a1');

    expect(service.rewind).not.toHaveBeenCalled();
    expect(tab.controllers.inputController?.sendMessage).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledWith('Cannot redo while streaming');
  });
});
