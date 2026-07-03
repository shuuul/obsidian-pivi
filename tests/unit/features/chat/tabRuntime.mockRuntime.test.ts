import { SubagentManager } from "@/ui/chat/services/SubagentManager";
import { ChatState } from "@/ui/chat/state/ChatState";
import { initializeTabService } from "@/ui/chat/tabs/tabRuntime";
import type { TabData } from "@/ui/chat/tabs/types";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import { createFakePiChatService } from "../../../helpers/fakePiChatService";

jest.mock("@pivi/pivi-agent-core/engine/pi/piChatRuntime", () => ({
  PiChatRuntime: jest.fn(),
}));
const mockPiChatRuntimeConstructor = PiChatRuntime as jest.Mock;

function minimalTab(): TabData {
  const contentEl = {} as HTMLElement;
  const richInput = {
    el: {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      setAttr: jest.fn(),
    } as unknown as HTMLDivElement,
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    focus: jest.fn(),
    getBoundingClientRect: () =>
      ({ top: 0, left: 0, width: 0, height: 0 }) as DOMRect,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    setMentionContextGetter: jest.fn(),
    handlePaste: jest.fn(),
  };
  return {
    id: "tab-test",
    lifecycleState: "bound_cold",
    draftModel: null,
    openSessionId: "conv-1",
    sessionFile: null,
    leafId: null,
    service: null,
    isArchived: false,
    serviceInitialized: false,
    state: new ChatState(),
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      openSessionController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
    },
    services: {
      subagentManager: new SubagentManager(() => {}),
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
      slashCommandDropdown: null,
      contextUsageMeter: null,
      sendButton: null,
      statusPanel: null,
      navigationSidebar: null,
    },
    dom: {
      contentEl,
      messagesWrapperEl: contentEl,
      messagesEl: contentEl,
      messagesBottomControlsEl: contentEl,
      welcomeEl: contentEl,
      statusPanelContainerEl: contentEl,
      inputContainerEl: contentEl,
      queueIndicatorEl: contentEl,
      inputWrapper: contentEl,
      richInput: richInput as unknown as TabData["dom"]["richInput"],
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

describe("initializeTabService with mock PiChatService", () => {

  it("assigns a Pi runtime and syncs openSession", async () => {
    const fakeRuntime = createFakePiChatService();
    mockPiChatRuntimeConstructor.mockReturnValue(fakeRuntime);

    const tab = minimalTab();
    const httpClient = { fetch: jest.fn() };
    const plugin = {
      settings: { persistentExternalContextPaths: [] },
      getPiWorkspace: jest.fn(() => null),
      getOpenSessionById: jest.fn(async () => ({
        id: "conv-1",
        title: "Test",
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: 0 }],
        externalContextPaths: ["ctx/a.md"],
      })),
      getAgentHostContext: jest.fn(() => ({
        settings: { persistentExternalContextPaths: [] },
        storage: {},
        vaultPath: "/mock-vault",
      })),
      httpClient,
    } as never;

    await initializeTabService(tab, plugin);

    expect(mockPiChatRuntimeConstructor).toHaveBeenCalledWith(
      plugin,
      {
        httpClient,
        mcpFetch: expect.any(Function),
        mcpProcessEnv: process.env,
      },
      null,
      null,
      null,
    );
    expect(tab.service).toBe(fakeRuntime);
    expect(tab.serviceInitialized).toBe(true);
    expect(tab.lifecycleState).toBe("bound_active");
    expect(fakeRuntime.syncSession).toHaveBeenCalledWith(
      { sessionFile: null },
      ["ctx/a.md"],
    );

    mockPiChatRuntimeConstructor.mockReset();
  });
});
