import { SubagentManager } from "@/ui/chat/services/SubagentManager";
import { ChatState } from "@/ui/chat/state/ChatState";
import { initializeTabService } from "@/ui/chat/tabs/tabRuntime";
import type { TabData } from "@/ui/chat/tabs/types";
import { createFakeChatPorts } from "../../../helpers/createFakeChatPorts";
import { createFakePiChatService } from "../../../helpers/fakePiChatService";

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
    draftTitle: null,
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
      externalContextSelector: null,
      slashCommandDropdown: null,
    },
    dom: {
      contentEl,
      messagesWrapperEl: contentEl,
      messagesEl: contentEl,
      messagesPortalEl: contentEl,
      messagesBottomControlsEl: contentEl,
      welcomePortalEl: contentEl,
      todoPortalEl: contentEl,
      navigationPortalEl: contentEl,
      queuePortalEl: contentEl,
      inputContainerEl: contentEl,
      inputWrapper: contentEl,
      richInput: richInput as unknown as TabData["dom"]["richInput"],
      composerPortalEl: contentEl,
      contextRowEl: contentEl,
      selectionIndicatorEl: null,
      browserIndicatorEl: null,
      canvasIndicatorEl: null,
      eventCleanups: [],
    },
    renderer: null,
  };
}

describe("initializeTabService with injected PiChatService", () => {
  it("does not create a service for an already-closing tab", async () => {
    const createChatService = jest.fn(() => createFakePiChatService());
    const getOpenSession = jest.fn();
    const tab = minimalTab();
    tab.lifecycleState = "closing";
    const ports = createFakeChatPorts({
      runtime: { createChatService },
      sessions: { getOpenSession },
    });

    await initializeTabService(tab, ports);

    expect(createChatService).not.toHaveBeenCalled();
    expect(getOpenSession).not.toHaveBeenCalled();
    expect(tab.service).toBeNull();
    expect(tab.serviceInitialized).toBe(false);
    expect(tab.lifecycleState).toBe("closing");
  });

  it("initializes a bound_cold tab as bound_active", async () => {
    const fakeRuntime = createFakePiChatService();
    const createChatService = jest.fn(() => fakeRuntime);

    const tab = minimalTab();
    const ports = createFakeChatPorts({
      runtime: { createChatService },
      sessions: { getOpenSession: jest.fn(async () => ({
        id: "conv-1",
        title: "Test",
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: 0 }],
        externalContextPaths: ["ctx/a.md"],
      }) as never) },
    });
    const settingsSnapshot = ports.settings.getSettingsSnapshot();
    settingsSnapshot.externalReadDirectories = ["/settings/pin"];
    ports.settings.getSettingsSnapshot = () => settingsSnapshot;

    await initializeTabService(tab, ports);

    expect(createChatService).toHaveBeenCalledTimes(1);
    expect(tab.service).toBe(fakeRuntime);
    expect(tab.serviceInitialized).toBe(true);
    expect(tab.lifecycleState).toBe("bound_active");
    expect(fakeRuntime.syncSession).toHaveBeenCalledWith(
      { sessionFile: null },
      ["/settings/pin"],
    );
  });

  it("preserves the tab's selected external roots when restarting its runtime", async () => {
    const fakeRuntime = createFakePiChatService();
    const tab = minimalTab();
    tab.ui.externalContextSelector = {
      getExternalContexts: jest.fn(() => ['/turn/context']),
    } as never;
    const ports = createFakeChatPorts({
      runtime: { createChatService: jest.fn(() => fakeRuntime) },
      sessions: { getOpenSession: jest.fn(async () => ({
        id: 'conv-1',
        sessionFile: 'sessions/conv-1.jsonl',
        messages: [],
      }) as never) },
    });

    await initializeTabService(tab, ports);

    expect(fakeRuntime.syncSession).toHaveBeenCalledWith(
      { sessionFile: 'sessions/conv-1.jsonl' },
      ['/turn/context'],
    );
  });

  it("does not publish a service when the tab closes while session lookup is suspended", async () => {
    let resolveOpenSession!: (session: { id: string; sessionFile: string }) => void;
    const openSessionPromise = new Promise<{ id: string; sessionFile: string }>(
      (resolve) => { resolveOpenSession = resolve; },
    );
    const unsubscribeSubagent = jest.fn();
    const fakeRuntime = createFakePiChatService();
    fakeRuntime.onSubagentChunk = jest.fn(() => unsubscribeSubagent);
    const createChatService = jest.fn(() => fakeRuntime);
    const tab = minimalTab();
    const ports = createFakeChatPorts({
      runtime: { createChatService },
      sessions: { getOpenSession: jest.fn(() => openSessionPromise as never) },
    });

    const initialization = initializeTabService(tab, ports);
    expect(createChatService).not.toHaveBeenCalled();
    tab.lifecycleState = "closing";
    resolveOpenSession({ id: "conv-1", sessionFile: "sessions/conv-1.jsonl" });
    await initialization;

    expect(createChatService).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.onReadyStateChange).not.toHaveBeenCalled();
    expect(fakeRuntime.onSubagentChunk).toHaveBeenCalledTimes(1);
    expect(unsubscribeSubagent).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.cleanup).toHaveBeenCalledTimes(1);
    expect(tab.service).toBeNull();
    expect(tab.serviceInitialized).toBe(false);
    expect(tab.lifecycleState).toBe("closing");

    tab.dom.eventCleanups[0]?.();
    expect(unsubscribeSubagent).toHaveBeenCalledTimes(1);
    expect(fakeRuntime.cleanup).toHaveBeenCalledTimes(1);
  });

  it("registers subagent chunk subscription cleanup without a ready-state listener", async () => {
    const unsubscribeSubagent = jest.fn();
    const fakeRuntime = createFakePiChatService();
    fakeRuntime.onSubagentChunk = jest.fn(() => unsubscribeSubagent);
    const createChatService = jest.fn(() => fakeRuntime);
    const tab = minimalTab();
    const ports = createFakeChatPorts({
      runtime: { createChatService },
      sessions: { getOpenSession: jest.fn(async () => null) },
    });

    await initializeTabService(tab, ports);

    expect(fakeRuntime.onReadyStateChange).not.toHaveBeenCalled();
    expect(fakeRuntime.onSubagentChunk).toHaveBeenCalledTimes(1);
    expect(tab.dom.eventCleanups).toHaveLength(1);

    tab.dom.eventCleanups[0]?.();
    expect(unsubscribeSubagent).toHaveBeenCalledTimes(1);
  });

  it("reuses the service when initialization is repeated on an active tab", async () => {
    const existingService = createFakePiChatService();
    const replacementService = createFakePiChatService();
    const createChatService = jest.fn(() => replacementService);
    const tab = minimalTab();
    tab.lifecycleState = "bound_active";
    tab.service = existingService;
    tab.serviceInitialized = true;

    const ports = createFakeChatPorts({
      runtime: { createChatService },
      sessions: { getOpenSession: jest.fn(async () => null) },
    });

    await initializeTabService(tab, ports);

    expect(createChatService).not.toHaveBeenCalled();
    expect(tab.service).toBe(existingService);
    expect(existingService.cleanup).not.toHaveBeenCalled();
    expect(existingService.syncSession).not.toHaveBeenCalled();
    expect(tab.serviceInitialized).toBe(true);
    expect(tab.lifecycleState).toBe("bound_active");
  });
});
