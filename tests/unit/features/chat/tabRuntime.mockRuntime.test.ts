import { AgentServices } from '../../../../src/core/agent/AgentServices';
import { SubagentManager } from '../../../../src/features/chat/services/SubagentManager';
import { ChatState } from '../../../../src/features/chat/state/ChatState';
import { initializeTabService } from '../../../../src/features/chat/tabs/tabRuntime';
import type { TabData } from '../../../../src/features/chat/tabs/types';
import { bootstrapPiAgent } from '../../../../src/pi/bootstrap';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

function minimalTab(): TabData {
  const contentEl = {} as HTMLElement;
  const inputEl = { addEventListener: jest.fn(), removeEventListener: jest.fn() } as unknown as HTMLTextAreaElement;
  return {
    id: 'tab-test',
    lifecycleState: 'bound_cold',
    draftModel: null,
    conversationId: 'conv-1',
    service: null,
    serviceInitialized: false,
    state: new ChatState(),
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager: new SubagentManager(() => {}),
      instructionRefineService: null,
      titleGenerationService: null,
    },
    ui: {
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      modeSelector: null,
      thinkingBudgetSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      contextUsageMeter: null,
      statusPanel: null,
      navigationSidebar: null,
    },
    dom: {
      contentEl,
      messagesEl: contentEl,
      welcomeEl: contentEl,
      statusPanelContainerEl: contentEl,
      inputContainerEl: contentEl,
      queueIndicatorEl: contentEl,
      inputWrapper: contentEl,
      inputEl,
      navRowEl: contentEl,
      contextRowEl: contentEl,
      selectionIndicatorEl: null,
      browserIndicatorEl: null,
      canvasIndicatorEl: null,
      eventCleanups: [],
    },
    renderer: null,
  };
}

describe('initializeTabService with mock ChatRuntime', () => {
  beforeAll(() => {
    bootstrapPiAgent();
  });

  it('assigns runtime from AgentServices.createChatRuntime and syncs conversation', async () => {
    const fakeRuntime = createFakeChatRuntime();
    const createSpy = jest.spyOn(AgentServices, 'createChatRuntime').mockReturnValue(fakeRuntime);

    const tab = minimalTab();
    const plugin = {
      settings: { persistentExternalContextPaths: [] },
      getConversationById: jest.fn(async () => ({
        id: 'conv-1',
        title: 'Test',
        messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }],
        externalContextPaths: ['ctx/a.md'],
      })),
    } as never;

    await initializeTabService(tab, plugin);

    expect(createSpy).toHaveBeenCalled();
    expect(tab.service).toBe(fakeRuntime);
    expect(tab.serviceInitialized).toBe(true);
    expect(tab.lifecycleState).toBe('bound_active');
    expect(fakeRuntime.syncConversationState).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1' }),
      ['ctx/a.md'],
    );

    createSpy.mockRestore();
  });
});
