import { TitleGenerationCoordinator } from '@/ui/chat/controllers/TitleGenerationCoordinator';
import type { ChatState } from '@/ui/chat/state/ChatState';
import type { SessionController } from '@/ui/chat/controllers/SessionController';
import type PiviPlugin from '@/app/PiviPluginHost';
import type { TitleGenerationService } from '@pivi/pi-runtime/auxTypes';
import type { PiChatService } from '@pivi/pi-runtime/PiChatService';

describe('TitleGenerationCoordinator', () => {
  let mockPlugin: jest.Mocked<PiviPlugin>;
  let mockState: jest.Mocked<ChatState>;
  let mockSessionController: jest.Mocked<SessionController>;
  let mockTitleService: jest.Mocked<TitleGenerationService>;
  let mockAgentService: jest.Mocked<PiChatService>;
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
    } as unknown as jest.Mocked<PiviPlugin>;

    mockState = {
      messages: [{ role: 'user', content: 'Hello agent!' }],
      currentOpenSessionId: null,
    } as unknown as jest.Mocked<ChatState>;

    mockSessionController = {
      generateFallbackTitle: jest.fn().mockReturnValue('Fallback Title'),
      updateHistoryDropdown: jest.fn(),
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

    coordinator = new TitleGenerationCoordinator({
      plugin: mockPlugin,
      state: mockState,
      openSessionController: mockSessionController,
      getTitleGenerationService: () => mockTitleService,
      getAgentService: () => mockAgentService,
      ensureServiceInitialized: jest.fn().mockResolvedValue(true),
    });
  });

  it('sets fallback title on first user message', async () => {
    await coordinator.triggerTitleGeneration();
    expect(mockSessionController.generateFallbackTitle).toHaveBeenCalledWith('Hello agent!');
    expect(mockPlugin.renameSession).toHaveBeenCalledWith('session-123', 'Fallback Title');
  });

  it('triggers AI title generation and renames session on success', async () => {
    await coordinator.triggerTitleGeneration();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTitleService.generateTitle).toHaveBeenCalled();
    expect(mockPlugin.renameSession).toHaveBeenLastCalledWith('session-123', 'AI Generated Title');
    expect(mockPlugin.updateSession).toHaveBeenCalledWith('session-123', { titleGenerationStatus: 'success' });
  });

  it('does not trigger title generation if message length is not 1', async () => {
    mockState.messages.push({ id: 'msg-2', role: 'assistant', content: 'Hi!', timestamp: Date.now() });
    await coordinator.triggerTitleGeneration();
    expect(mockPlugin.createOpenSession).not.toHaveBeenCalled();
  });
});
