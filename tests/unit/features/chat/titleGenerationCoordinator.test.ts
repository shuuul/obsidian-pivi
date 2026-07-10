import { TitleGenerationCoordinator } from '@/ui/chat/controllers/TitleGenerationCoordinator';
import type { ChatState } from '@/ui/chat/state/ChatState';
import type { SessionController } from '@/ui/chat/controllers/SessionController';
import type { PiviChatHost } from '@/app/hostContracts';
import type { TitleGenerationService } from '@pivi/pivi-agent-core/runtime/auxTypes';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';

describe('TitleGenerationCoordinator', () => {
  let mockPlugin: jest.Mocked<PiviChatHost>;
  let mockState: jest.Mocked<ChatState>;
  let mockSessionController: jest.Mocked<SessionController>;
  let mockTitleService: jest.Mocked<TitleGenerationService>;
  let mockAgentService: jest.Mocked<PiChatService>;
  let onTitleChanged: jest.Mock;
  let coordinator: TitleGenerationCoordinator;

  beforeEach(() => {
    mockPlugin = {
      createOpenSession: jest.fn().mockResolvedValue({ id: 'session-123' }),
      renameSession: jest.fn(),
      updateSession: jest.fn(),
      getOpenSessionById: jest.fn().mockResolvedValue({ id: 'session-123', title: 'Fallback Title' }),
      settings: {
        enableAutoTitleGeneration: true,
      },
    } as unknown as jest.Mocked<PiviChatHost>;

    mockState = {
      messages: [{ role: 'user', content: 'Hello agent!' }],
      currentOpenSessionId: null,
    } as unknown as jest.Mocked<ChatState>;

    mockSessionController = {
      generateFallbackTitle: jest.fn().mockReturnValue('Fallback Title'),
    } as unknown as jest.Mocked<SessionController>;

    mockTitleService = {
      generateTitle: jest.fn().mockImplementation(async (convId, userContent, callback) => {
        await callback(convId, { success: true, title: 'AI Generated Title' });
      }),
    } as unknown as jest.Mocked<TitleGenerationService>;

    mockAgentService = {
      getSessionId: jest.fn().mockReturnValue('agent-session-id'),
      getSessionStateUpdates: jest.fn().mockReturnValue({ sessionFile: 'file.jsonl', leafId: 'leaf-1' }),
    } as unknown as jest.Mocked<PiChatService>;

    onTitleChanged = jest.fn();

    coordinator = new TitleGenerationCoordinator({
      plugin: mockPlugin,
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
    expect(mockPlugin.renameSession).toHaveBeenCalledWith('session-123', 'Fallback Title', 'firstPrompt');
    expect(onTitleChanged).toHaveBeenCalledWith('Fallback Title');
  });

  it('triggers AI title generation and renames session on success', async () => {
    await coordinator.triggerTitleGeneration();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTitleService.generateTitle).toHaveBeenCalled();
    expect(mockPlugin.renameSession).toHaveBeenLastCalledWith('session-123', 'AI Generated Title', 'model');
    expect(onTitleChanged).toHaveBeenCalledWith('AI Generated Title');
  });

  it('does not overwrite a custom title with generated title', async () => {
    mockPlugin.getOpenSessionById.mockResolvedValue({
      id: 'session-123',
      title: 'Custom title',
      titleSource: 'custom',
    } as never);

    await coordinator.triggerTitleGeneration();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockPlugin.renameSession).not.toHaveBeenCalled();
    expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
    expect(mockPlugin.updateSession).not.toHaveBeenCalled();
  });

  it('applies blank-tab draft custom title and skips AI generation', async () => {
    const clearDraftCustomTitle = jest.fn();
    coordinator = new TitleGenerationCoordinator({
      plugin: mockPlugin,
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
    await Promise.resolve();
    await Promise.resolve();

    expect(mockPlugin.renameSession).toHaveBeenCalledWith('session-123', 'My Draft Title', 'custom');
    expect(clearDraftCustomTitle).toHaveBeenCalled();
    expect(onTitleChanged).toHaveBeenCalledWith('My Draft Title');
    expect(mockSessionController.generateFallbackTitle).not.toHaveBeenCalled();
    expect(mockTitleService.generateTitle).not.toHaveBeenCalled();
  });

  it('does not trigger title generation if message length is not 1', async () => {
    mockState.messages.push({ id: 'msg-2', role: 'assistant', content: 'Hi!', timestamp: Date.now() });
    await coordinator.triggerTitleGeneration();
    expect(mockPlugin.createOpenSession).not.toHaveBeenCalled();
  });
});
