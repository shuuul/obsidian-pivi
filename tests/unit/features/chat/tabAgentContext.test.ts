import { ensureTitleGenerationService, shouldSendMessageFromEnterKey } from '@/ui/chat/tabs/tabAgentContext';
import type { TabData } from '@/ui/chat/tabs/types';
import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';

const mockQuery = jest.fn(async () => '"Generated tab title"');
const mockReset = jest.fn();

jest.mock('@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner', () => ({
  createPiAuxQueryRunner: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    reset: mockReset,
  })),
}));

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return partial as KeyboardEvent;
}

function makeTab(titleGenerationService: TabData['services']['titleGenerationService'] = null): TabData {
  return {
    id: 'tab-1',
    lifecycleState: 'blank',
    draftModel: null,
    openSessionId: null,
    sessionFile: null,
    leafId: null,
    service: null,
    isArchived: false,
    serviceInitialized: false,
    state: { messages: [], isStreaming: false } as never,
    controllers: {} as never,
    services: { titleGenerationService } as never,
    ui: {} as never,
    dom: {} as never,
    renderer: null,
  };
}

describe('ensureTitleGenerationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wires QueryBackedTitleGenerationService with PiAuxQueryRunner (no pi-runtime services wrapper)', async () => {
    const plugin = asPiviPlugin(
      createMockPiviPluginStub({ settings: { titleGenerationModel: ' anthropic/title-model ' } }),
    );
    const tab = makeTab();

    ensureTitleGenerationService(tab, plugin);

    const service = tab.services.titleGenerationService;
    expect(service).not.toBeNull();
    expect(typeof service!.generateTitle).toBe('function');
    expect(typeof service!.cancel).toBe('function');

    const callback = jest.fn(async () => {});
    await service!.generateTitle('open-session-1', 'user message body', callback);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'anthropic/title-model',
        systemPrompt: expect.stringContaining('Generate a **concise, descriptive title**'),
      }),
      expect.stringContaining('user message body'),
    );
    expect(callback).toHaveBeenCalledWith('open-session-1', {
      success: true,
      title: 'Generated tab title',
    });
    expect(mockReset).toHaveBeenCalled();
  });

  it('does not replace an existing title generation service', () => {
    const existing = {
      generateTitle: jest.fn(),
      cancel: jest.fn(),
    };
    const tab = makeTab(existing);
    const plugin = asPiviPlugin(createMockPiviPluginStub());

    ensureTitleGenerationService(tab, plugin);

    expect(tab.services.titleGenerationService).toBe(existing);
  });
});

describe('shouldSendMessageFromEnterKey', () => {
  it('sends on Enter when modifier not required', () => {
    expect(shouldSendMessageFromEnterKey(
      keyEvent({ key: 'Enter' }),
      { requireCommandOrControlEnterToSend: false },
    )).toBe(true);
  });

  it('ignores Shift+Enter', () => {
    expect(shouldSendMessageFromEnterKey(
      keyEvent({ key: 'Enter', shiftKey: true }),
      { requireCommandOrControlEnterToSend: false },
    )).toBe(false);
  });
});
