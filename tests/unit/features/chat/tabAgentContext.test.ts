import {
  ensureTitleGenerationService,
  resolveBlankTabModel,
  shouldSendMessageFromEnterKey,
  updateTabAgentSettings,
} from '@/ui/chat/tabs/tabAgentContext';
import type { TabData } from '@/ui/chat/tabs/types';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';

const mockQuery = jest.fn(async () => '"Generated tab title"');
const mockReset = jest.fn();
const mockCreateAuxQueryRunner = jest.fn().mockImplementation(() => ({
  query: mockQuery,
  reset: mockReset,
}));

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return partial as KeyboardEvent;
}

function makeTab(titleGenerationService: TabData['services']['titleGenerationService'] = null): TabData {
  return {
    id: 'tab-1',
    lifecycleState: 'blank',
    draftModel: null,
    draftTitle: null,
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

  it('wires QueryBackedTitleGenerationService via the runtime port', async () => {
    const ports = createFakeChatPorts({
      runtime: { createAuxQueryRunner: mockCreateAuxQueryRunner },
    });
    const snapshot = ports.settings.getSettingsSnapshot();
    snapshot.titleGenerationModel = ' anthropic/title-model ';
    ports.settings.getSettingsSnapshot = () => snapshot;
    const tab = makeTab();

    ensureTitleGenerationService(tab, ports);

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
    const ports = createFakeChatPorts();

    ensureTitleGenerationService(tab, ports);

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

  it.each([
    ['plain Enter', { key: 'Enter' }, false],
    ['Command+Enter', { key: 'Enter', metaKey: true }, true],
    ['Ctrl+Enter', { key: 'Enter', ctrlKey: true }, true],
    ['Shift+Enter', { key: 'Enter', shiftKey: true }, false],
    ['Alt+Enter', { key: 'Enter', altKey: true }, false],
    ['composing Enter', { key: 'Enter', isComposing: true }, false],
  ] as const)('%s when modifier send is required', (_label, event, expected) => {
    expect(shouldSendMessageFromEnterKey(
      keyEvent(event),
      { requireCommandOrControlEnterToSend: true },
    )).toBe(expected);
  });
});

describe('chat settings ports', () => {
  it('resolves a blank-tab model from the projected settings snapshot', () => {
    const ports = createFakeChatPorts();
    const snapshot = ports.settings.getSettingsSnapshot();
    snapshot.model = 'model-a';
    ports.settings.getSettingsSnapshot = () => snapshot;

    expect(resolveBlankTabModel(ports)).toBe('model-a');
  });

  it('mutates one snapshot and commits it once', async () => {
    const ports = createFakeChatPorts();
    const snapshot = ports.settings.getSettingsSnapshot();
    snapshot.model = 'model-a';
    const commitSettingsSnapshot = jest.fn(async () => undefined);
    ports.settings.getSettingsSnapshot = () => snapshot;
    ports.settings.commitSettingsSnapshot = commitSettingsSnapshot;

    const result = await updateTabAgentSettings(ports, (settings) => {
      settings.model = 'model-b';
    });

    expect(result).toBe(snapshot);
    expect(commitSettingsSnapshot).toHaveBeenCalledTimes(1);
    expect(commitSettingsSnapshot).toHaveBeenCalledWith(snapshot);
    expect(snapshot.model).toBe('model-b');
  });
});
