import { PiAgentServices } from '../../../../src/core/agent/PiAgentServices';
import { SubagentManager } from '../../../../src/features/chat/services/SubagentManager';
import { ChatState } from '../../../../src/features/chat/state/ChatState';
import { initializeTabService } from '../../../../src/features/chat/tabs/tabRuntime';
import type { TabData } from '../../../../src/features/chat/tabs/types';
import { ensurePiAgentBootstrapped } from '../../../setupPiAgent';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

function minimalTab(): TabData {
  const contentEl = {} as HTMLElement;
  const richInput = {
    el: { addEventListener: jest.fn(), removeEventListener: jest.fn(), setAttr: jest.fn() } as unknown as HTMLDivElement,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus: jest.fn(),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 } as DOMRect),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setMentionContextGetter: jest.fn(),
    handlePaste: jest.fn(),
  };
  return {
    id: 'tab-test',
    lifecycleState: 'bound_cold',
    draftModel: null,
    conversationId: 'conv-1',
    sessionFile: null,
    leafId: null,
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
      inlineContextManager: null,
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
      sendButton: null,
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
      richInput: richInput as unknown as TabData['dom']['richInput'],
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
    ensurePiAgentBootstrapped();
  });

  it('assigns runtime from PiAgentServices.createChatRuntime and syncs conversation', async () => {
    const fakeRuntime = createFakeChatRuntime();
    const createSpy = jest.spyOn(PiAgentServices, 'createChatRuntime').mockReturnValue(fakeRuntime);

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
