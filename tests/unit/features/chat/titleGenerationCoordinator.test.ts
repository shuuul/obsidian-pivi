import { TitleGenerationCoordinator } from '@/ui/chat/controllers/TitleGenerationCoordinator';
import type { ChatState } from '@/ui/chat/state/ChatState';
import type { SessionController } from '@/ui/chat/controllers/SessionController';
import type { TitleGenerationService } from '@pivi/pivi-agent-core/runtime/auxTypes';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Notice } from 'obsidian';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';

async function flushBackgroundTitleGeneration(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('TitleGenerationCoordinator', () => {
  let mockSessions: jest.Mocked<ChatPorts['sessions']>;
  let settings: ChatPorts['settings'];
  let mockState: jest.Mocked<ChatState>;
  let mockSessionController: jest.Mocked<SessionController>;
  let mockTitleService: jest.Mocked<TitleGenerationService>;
  let mockAgentService: jest.Mocked<PiChatService>;
  let onTitleChanged: jest.Mock;
  let coordinator: TitleGenerationCoordinator;

  beforeEach(() => {
    jest.mocked(Notice).mockClear();
    const ports = createFakeChatPorts({
      sessions: {
        createSession: jest.fn().mockResolvedValue({ id: 'session-123' }),
        renameSession: jest.fn(async () => undefined),
        updateSession: jest.fn(async () => undefined),
        getOpenSession: jest.fn().mockResolvedValue({
          id: 'session-123',
          title: 'Fallback Title',
        }),
      },
    });
    const settingsSnapshot = ports.settings.getSettingsSnapshot();
    settingsSnapshot.enableAutoTitleGeneration = true;
    ports.settings.getSettingsSnapshot = jest.fn(() => settingsSnapshot);
    mockSessions = ports.sessions as jest.Mocked<ChatPorts['sessions']>;
    settings = ports.settings;

    mockState = {
      messages: [{ role: 'user', content: 'Hello agent!' }],
      currentOpenSessionId: null,
    } as unknown as jest.Mocked<ChatState>;

    mockSessionController = {
      generateFallbackTitle: jest.fn().mockReturnValue('Fallback Title'),
    } as unknown as jest.Mocked<SessionController>;

    mockTitleService = {
      generateTitle: jest.fn().mockResolvedValue({
        success: true,
        title: 'AI Generated Title',
      }),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<TitleGenerationService>;

    mockAgentService = {
      getSessionId: jest.fn().mockReturnValue('agent-session-id'),
      getSessionStateUpdates: jest.fn().mockReturnValue({ sessionFile: 'file.jsonl', leafId: 'leaf-1' }),
    } as unknown as jest.Mocked<PiChatService>;

    onTitleChanged = jest.fn();

    coordinator = new TitleGenerationCoordinator({
      settings,
      sessions: mockSessions,
      state: mockState,
      openSessionController: mockSessionController,
      getTitleGenerationService: () => mockTitleService,
      getAgentService: () => mockAgentService,
      ensureServiceInitialized: jest.fn().mockResolvedValue(true),
      onTitleChanged,
    });
  });

  it('sets fallback title on first user message', async () => {
    await coordinator.triggerTitleGeneration();
    expect(mockSessionController.generateFallbackTitle).toHaveBeenCalledWith('Hello agent!');
    expect(mockSessions.renameSession).toHaveBeenCalledWith('session-123', 'Fallback Title', 'firstPrompt');
    expect(onTitleChanged).toHaveBeenCalledWith('Fallback Title');
  });

  it('triggers AI title generation and renames session on success', async () => {
    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockTitleService.generateTitle).toHaveBeenCalledWith(
      'session-123',
      'Hello agent!',
    );
    expect(mockSessions.renameSession).toHaveBeenLastCalledWith('session-123', 'AI Generated Title', 'model');
    expect(onTitleChanged).toHaveBeenCalledWith('AI Generated Title');
  });

  it('publishes the generated title only after metadata persistence succeeds', async () => {
    let resolvePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve;
    });
    mockSessions.renameSession.mockImplementation(async (_id, _title, source) => {
      if (source === 'model') {
        await persistence;
      }
    });

    await coordinator.triggerTitleGeneration();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSessions.renameSession).toHaveBeenLastCalledWith(
      'session-123',
      'AI Generated Title',
      'model',
    );
    expect(onTitleChanged).not.toHaveBeenCalledWith('AI Generated Title');

    resolvePersistence();
    await flushBackgroundTitleGeneration();

    expect(onTitleChanged).toHaveBeenCalledWith('AI Generated Title');
  });

  it('keeps the fallback title when the model query fails', async () => {
    mockTitleService.generateTitle.mockResolvedValue({
      success: false,
      error: 'provider unavailable',
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockSessions.renameSession).toHaveBeenCalledTimes(1);
    expect(mockSessions.renameSession).toHaveBeenCalledWith(
      'session-123',
      'Fallback Title',
      'firstPrompt',
    );
    expect(onTitleChanged).toHaveBeenCalledTimes(1);
    expect(Notice).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not overwrite a title customized while the model query is running', async () => {
    mockSessions.getOpenSession
      .mockResolvedValueOnce({
        id: 'session-123',
        title: 'Fallback Title',
        titleSource: 'firstPrompt',
      } as never)
      .mockResolvedValueOnce({
        id: 'session-123',
        title: 'My custom title',
        titleSource: 'custom',
      } as never);

    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockSessions.renameSession).toHaveBeenCalledTimes(1);
    expect(mockSessions.renameSession).not.toHaveBeenCalledWith(
      'session-123',
      'AI Generated Title',
      'model',
    );
    expect(onTitleChanged).not.toHaveBeenCalledWith('AI Generated Title');
  });

  it('shows an error and leaves the fallback visible when model title persistence fails', async () => {
    mockSessions.renameSession.mockImplementation(async (_id, _title, source) => {
      if (source === 'model') {
        throw new Error('append failed');
      }
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockSessions.renameSession).toHaveBeenLastCalledWith(
      'session-123',
      'AI Generated Title',
      'model',
    );
    expect(onTitleChanged).not.toHaveBeenCalledWith('AI Generated Title');
    expect(Notice).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('does not overwrite a custom title with generated title', async () => {
    mockSessions.getOpenSession.mockResolvedValue({
      id: 'session-123',
      title: 'Custom title',
      titleSource: 'custom',
    } as never);

    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockSessions.renameSession).not.toHaveBeenCalled();
    expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    expect(mockSessions.updateSession).not.toHaveBeenCalled();
  });

  it('applies blank-tab draft custom title and skips AI generation', async () => {
    const clearDraftCustomTitle = jest.fn();
    coordinator = new TitleGenerationCoordinator({
      settings,
      sessions: mockSessions,
      state: mockState,
      openSessionController: mockSessionController,
      getTitleGenerationService: () => mockTitleService,
      getAgentService: () => mockAgentService,
      ensureServiceInitialized: jest.fn().mockResolvedValue(true),
      onTitleChanged,
      getDraftCustomTitle: () => '  My Draft Title  ',
      clearDraftCustomTitle,
    });

    await coordinator.triggerTitleGeneration();
    await flushBackgroundTitleGeneration();

    expect(mockSessions.renameSession).toHaveBeenCalledWith('session-123', 'My Draft Title', 'custom');
    expect(clearDraftCustomTitle).toHaveBeenCalled();
    expect(onTitleChanged).toHaveBeenCalledWith('My Draft Title');
    expect(mockSessionController.generateFallbackTitle).not.toHaveBeenCalled();
    expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
  });

  it('does not trigger title generation if message length is not 1', async () => {
    mockState.messages.push({ id: 'msg-2', role: 'assistant', content: 'Hi!', timestamp: Date.now() });
    await coordinator.triggerTitleGeneration();
    expect(mockSessions.createSession).not.toHaveBeenCalled();
  });
});
