import { act, fireEvent, screen, within } from '@testing-library/react';

import { createI18n } from '@pivi/pivi-react';
import { ActiveChatUiBridge, mountChatView } from '@pivi/pivi-react/mount';
import {
  ChatTabsStore,
  ChatProjectionStore,
  ChatUiStore,
  type ChatTabActions,
  type ChatTabsSnapshot,
} from '@pivi/pivi-react/store';
import { calculateContextEnvelope } from '@pivi/pivi-agent-core/foundation/usage';

import { testPresentationPlatform } from '../helpers/presentationPlatform';

function snapshot(position: 'input' | 'header' = 'header'): ChatTabsSnapshot {
  return {
    chatIcon: { kind: 'pivi-brand', viewBox: '0 0 100 100' },
    items: [
      {
        id: 'active',
        index: 1,
        title: 'Active chat',
        isActive: true,
        isStreaming: true,
        needsAttention: false,
        isArchived: false,
        canClose: true,
      },
      {
        id: 'attention',
        index: 2,
        title: 'Needs attention',
        isActive: false,
        isStreaming: false,
        needsAttention: true,
        isArchived: false,
        canClose: true,
      },
      {
        id: 'archived',
        index: 3,
        title: 'Archived chat',
        isActive: false,
        isStreaming: false,
        needsAttention: false,
        isArchived: true,
        canClose: true,
      },
    ],
    position,
  };
}

function actions(): jest.Mocked<ChatTabActions> {
  return {
    archiveTab: jest.fn(),
    closeTab: jest.fn(),
    renameTab: jest.fn(),
    startNewChat: jest.fn(),
    switchTab: jest.fn(),
  };
}

async function mountShell(options: {
  position?: 'input' | 'header';
  ownerDocument?: Document;
  ownerWindow?: Window;
  activeChat?: ActiveChatUiBridge;
  surfaceActions?: {
    editQueuedTurn: () => void;
    discardQueuedTurn: () => void;
    scrollToTop: () => void;
    scrollToPreviousUserMessage: () => void;
    scrollToNextUserMessage: () => void;
    scrollToBottom: () => void;
    resumeAutoScroll: () => void;
  };
}) {
  const ownerDocument = options.ownerDocument ?? document;
  const ownerWindow = options.ownerWindow ?? window;
  const host = ownerDocument.createElement('div');
  const inputPortal = ownerDocument.createElement('div');
  ownerDocument.body.append(host, inputPortal);
  const store = new ChatTabsStore(snapshot(options.position));
  const tabActions = actions();
  let mounted: Awaited<ReturnType<typeof mountChatView>>;
  await act(async () => {
    mounted = await mountChatView({
      chatShell: {
        actions: tabActions,
        activeChat: options.activeChat,
        inputPortalContainer: inputPortal,
        store,
        surfaceActions: options.surfaceActions,
      },
      container: host,
      i18n: createI18n(),
      imperativeAdapter: { dispose: () => {}, mount: () => {} },
      platform: testPresentationPlatform,
      ownerDocument,
      ownerWindow,
      portalContainer: ownerDocument.body,
    });
  });
  return { host, inputPortal, mounted: mounted!, store, tabActions };
}

function createPortalTargets(ownerDocument: Document = document) {
  const welcome = ownerDocument.createElement('div');
  const queue = ownerDocument.createElement('div');
  const todo = ownerDocument.createElement('div');
  const navigation = ownerDocument.createElement('div');
  const composer = ownerDocument.createElement('div');
  const messages = ownerDocument.createElement('div');
  return {
    welcome,
    queue,
    todo,
    navigation,
    composer,
    messages,
    messagesViewport: messages,
    remove: () => {
      welcome.remove();
      queue.remove();
      todo.remove();
      navigation.remove();
      composer.remove();
      messages.remove();
    },
  };
}

describe('React ChatShell tabs', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('owns header/logo and renders the tab bar in header mode', async () => {
    const mounted = await mountShell({ position: 'header' });
    const root = mounted.host.querySelector('[data-pivi-react-surface="chat"]');

    expect(root).toHaveClass('pivi-container--header-mode');
    expect(root?.querySelector('.pivi-header .pivi-brand-icon')).not.toBeNull();
    expect(root?.querySelector('.pivi-header .pivi-tab-switcher')).not.toBeNull();
    expect(mounted.inputPortal).toBeEmptyDOMElement();

    await act(async () => mounted.mounted.dispose());
  });

  it('portals the same-root tab bar into the supplied input host and follows store position', async () => {
    const mounted = await mountShell({ position: 'input' });
    expect(mounted.inputPortal.querySelector('.pivi-tab-switcher')).not.toBeNull();
    expect(mounted.host.querySelector('.pivi-header .pivi-tab-switcher')).toBeNull();

    act(() => mounted.store.update(snapshot('header')));

    expect(mounted.inputPortal).toBeEmptyDOMElement();
    expect(mounted.host.querySelector('.pivi-header .pivi-tab-switcher')).not.toBeNull();
    await act(async () => mounted.mounted.dispose());
  });

  it.each(['header', 'input'] as const)(
    'keeps the new-chat control visible and in right-aligned tab-bar flow in %s mode',
    async (position) => {
      const mounted = await mountShell({ position });
      const tabBar = position === 'header'
        ? mounted.host.querySelector('.pivi-header .pivi-tab-bar-container')
        : mounted.inputPortal.querySelector('.pivi-input-nav-content');
      const control = tabBar?.querySelector('.pivi-tab-switcher-control');
      const newChat = tabBar?.querySelector('.pivi-tab-switcher-new-chat');

      expect(tabBar).not.toBeNull();
      expect(newChat).toHaveClass('pivi-tab-switcher-new-chat');
      expect(newChat).not.toHaveClass('pivi-tab-switcher-action');
      expect(control?.firstElementChild).toBe(newChat);
      expect(control?.lastElementChild).toHaveClass('pivi-tab-switcher-trigger');

      await act(async () => mounted.mounted.dispose());
    },
  );

  it('projects state classes and delegates switch, create, rename, archive, and close actions', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'header' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch tab: Active chat' }));

    expect(document.querySelector('.pivi-tab-switcher-item[data-tab-id="active"] .is-live')).not.toBeNull();
    expect(document.querySelector('.pivi-tab-switcher-item[data-tab-id="attention"] .is-unread')).not.toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Needs attention' }));
    expect(mounted.tabActions.switchTab).toHaveBeenCalledWith('attention');

    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));
    expect(mounted.tabActions.startNewChat).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch tab: Active chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit title for Needs attention' }));
    const titleInput = screen.getByRole('textbox', { name: 'Tab title' });
    titleInput.textContent = 'Renamed';
    fireEvent.input(titleInput);
    fireEvent.keyDown(titleInput, { key: 'Enter' });
    expect(mounted.tabActions.renameTab).toHaveBeenCalledWith('attention', 'Renamed');

    fireEvent.click(screen.getByRole('button', { name: 'Archive Needs attention' }));
    act(() => jest.advanceTimersByTime(200));
    expect(mounted.tabActions.archiveTab).toHaveBeenCalledWith('attention');

    fireEvent.click(screen.getByRole('button', { name: 'Close Active chat' }));
    act(() => jest.advanceTimersByTime(200));
    expect(mounted.tabActions.closeTab).toHaveBeenCalledWith('active');

    await act(async () => mounted.mounted.dispose());
  });

  it('switches away immediately and commits one active-tab archive after store updates', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'input' });
    mounted.tabActions.switchTab.mockImplementation((id) => {
      mounted.store.update({
        ...snapshot('input'),
        items: snapshot('input').items.map(item => ({ ...item, isActive: item.id === id })),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch tab: Active chat' }));
    const archive = screen.getByRole('button', { name: 'Archive Active chat' });
    fireEvent.click(archive);
    fireEvent.click(archive);

    expect(mounted.tabActions.switchTab).toHaveBeenCalledTimes(1);
    expect(mounted.tabActions.switchTab).toHaveBeenCalledWith('attention');
    expect(mounted.tabActions.archiveTab).not.toHaveBeenCalled();
    expect(mounted.inputPortal.querySelector('.pivi-tab-switcher')).not.toBeNull();

    act(() => jest.advanceTimersByTime(200));
    expect(mounted.tabActions.archiveTab).toHaveBeenCalledTimes(1);
    expect(mounted.tabActions.archiveTab).toHaveBeenCalledWith('active');
    await act(async () => mounted.mounted.dispose());
  });

  it('guards duplicate close actions and does not select an exiting row from the keyboard', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'header' });
    fireEvent.click(screen.getByRole('button', { name: 'Switch tab: Active chat' }));
    const close = screen.getByRole('button', { name: 'Close Needs attention' });
    const row = screen.getByRole('menuitem', { name: 'Needs attention' });

    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.keyDown(row, { key: 'Enter' });
    act(() => jest.advanceTimersByTime(200));

    expect(mounted.tabActions.closeTab).toHaveBeenCalledTimes(1);
    expect(mounted.tabActions.closeTab).toHaveBeenCalledWith('attention');
    expect(mounted.tabActions.switchTab).not.toHaveBeenCalled();
    await act(async () => mounted.mounted.dispose());
  });

  it('keeps the menu mounted for its close animation for trigger and outside clicks', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'header' });
    const trigger = screen.getByRole('button', { name: 'Switch tab: Active chat' });
    fireEvent.click(trigger);
    fireEvent.click(document.body);

    expect(mounted.host.querySelector('.pivi-tab-switcher')).not.toHaveClass('is-open');
    expect(mounted.host.querySelector('.pivi-tab-switcher-menu')).toHaveClass('is-closing');
    act(() => jest.advanceTimersByTime(279));
    expect(mounted.host.querySelector('.pivi-tab-switcher-menu')).not.toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(mounted.host.querySelector('.pivi-tab-switcher-menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(mounted.host.querySelector('.pivi-tab-switcher-menu')).toHaveClass('is-closing');
    await act(async () => mounted.mounted.dispose());
  });

  it('preserves keyboard focus, Escape, edit cancellation, and caret placement', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'header' });
    const trigger = screen.getByRole('button', { name: 'Switch tab: Active chat' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Active chat' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Active chat' }), { key: 'ArrowDown' });
    const attentionRow = screen.getByRole('menuitem', { name: 'Needs attention' });
    expect(attentionRow).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title for Needs attention' }));
    const input = screen.getByRole<HTMLSpanElement>('textbox', { name: 'Tab title' });
    const selection = input.ownerDocument.defaultView?.getSelection();
    expect(selection?.isCollapsed).toBe(true);
    expect(input.contains(selection?.anchorNode ?? null)).toBe(true);
    input.textContent = 'Do not save';
    fireEvent.input(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(mounted.tabActions.renameTab).not.toHaveBeenCalled();

    fireEvent.keyDown(attentionRow, { key: 'Escape' });
    expect(mounted.host.querySelector('.pivi-tab-switcher-menu')).toHaveClass('is-closing');
    await act(async () => mounted.mounted.dispose());
  });

  it('caps the switcher at ten rows and opens around the active tab', async () => {
    const mounted = await mountShell({ position: 'header' });
    const items = Array.from({ length: 14 }, (_, index) => ({
      id: `tab-${index + 1}`,
      index: index + 1,
      title: `Chat ${index + 1}`,
      isActive: index === 11,
      isStreaming: false,
      needsAttention: false,
      isArchived: false,
      canClose: true,
    }));
    act(() => mounted.store.update({
      ...snapshot('header'),
      items,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Switch tab: Chat 12' }));
    const menu = screen.getByRole('menu');

    expect(menu).toHaveStyle({ maxHeight: '298px' });
    expect(menu.scrollTop).toBe(4 * 28);
    expect(screen.getAllByRole('menuitem')).toHaveLength(14);

    await act(async () => mounted.mounted.dispose());
  });

  it('animates active title changes in tab-index direction', async () => {
    jest.useFakeTimers();
    const mounted = await mountShell({ position: 'header' });
    const withActive = (id: string): ChatTabsSnapshot => ({
      ...snapshot('header'),
      items: snapshot('header').items.map(item => ({ ...item, isActive: item.id === id })),
    });

    act(() => mounted.store.update(withActive('attention')));
    let title = mounted.host.querySelector('.pivi-tab-switcher-title');
    expect(title).toHaveClass('is-scrolling-up');
    expect(title).toHaveTextContent('Active chat');
    act(() => jest.advanceTimersByTime(180));
    expect(title).toHaveTextContent('Needs attention');

    act(() => mounted.store.update(withActive('active')));
    title = mounted.host.querySelector('.pivi-tab-switcher-title');
    expect(title).toHaveClass('is-scrolling-down');
    act(() => jest.advanceTimersByTime(180));
    expect(title).toHaveTextContent('Active chat');
    await act(async () => mounted.mounted.dispose());
  });

  it('reveals archived tabs after the wheel threshold and uses the popout owner realm', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument;
    const ownerWindow = iframe.contentWindow;
    expect(ownerDocument).not.toBeNull();
    expect(ownerWindow).not.toBeNull();
    if (!ownerDocument || !ownerWindow) return;

    const mounted = await mountShell({ ownerDocument, ownerWindow, position: 'header' });
    const trigger = ownerDocument.querySelector<HTMLElement>('[aria-label="Switch tab: Active chat"]');
    expect(trigger?.ownerDocument).toBe(ownerDocument);
    fireEvent.click(trigger!);
    const menu = ownerDocument.querySelector<HTMLElement>('[role="menu"]');
    const WheelEventConstructor = (ownerWindow as unknown as { WheelEvent: typeof WheelEvent }).WheelEvent;
    const firstWheel = new WheelEventConstructor('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 40,
    });
    act(() => menu!.dispatchEvent(firstWheel));
    expect(firstWheel.defaultPrevented).toBe(true);
    expect(menu).not.toHaveClass('is-archived-revealed');
    const secondWheel = new WheelEventConstructor('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 40,
    });
    act(() => menu!.dispatchEvent(secondWheel));
    expect(menu).toHaveClass('is-archived-revealed');

    await act(async () => mounted.mounted.dispose());
  });

  it('projects active chat state into dedicated welcome, queue, usage, todo, and navigation portals', async () => {
    const bridge = new ActiveChatUiBridge();
    const uiStore = new ChatUiStore();
    const projectionStore = new ChatProjectionStore();
    const targets = createPortalTargets();
    const surfaceActions = {
      editQueuedTurn: jest.fn(),
      discardQueuedTurn: jest.fn(),
      scrollToTop: jest.fn(),
      scrollToPreviousUserMessage: jest.fn(),
      scrollToNextUserMessage: jest.fn(),
      scrollToBottom: jest.fn(),
      resumeAutoScroll: jest.fn(),
    };
    const composerActions = {
      send: jest.fn(),
      stop: jest.fn(),
      setModel: jest.fn(),
      setMode: jest.fn(),
      setThinkingBudget: jest.fn(),
      setThinkingLevel: jest.fn(),
      toggleExternalPath: jest.fn(),
      toggleExternalPinned: jest.fn(),
      removeExternalPath: jest.fn(),
      addExternalContext: jest.fn(),
    };
    bridge.setActive(uiStore, projectionStore, targets, composerActions);
    const mounted = await mountShell({
      activeChat: bridge,
      position: 'header',
      surfaceActions,
    });

    act(() => uiStore.update({ welcomeGreeting: 'Welcome back' }));
    expect(targets.welcome).toHaveTextContent('Welcome back');
    act(() => projectionStore.replaceAll([
      { content: 'Hello', id: 'message-1', role: 'user', timestamp: 1 },
    ]));
    expect(targets.welcome).toBeEmptyDOMElement();
    expect(targets.messages).toHaveTextContent('Hello');

    act(() => uiStore.update({
      thinkingIndicator: {
        className: 'pivi-thinking',
        elapsedLabel: ' (esc to interrupt · 0:03)',
        text: 'Distilling...',
      },
    }));
    const thinkingIndicator = targets.messages.querySelector('.pivi-thinking');
    expect(thinkingIndicator).toHaveClass('pivi-response-meta');
    expect(thinkingIndicator).toHaveTextContent('Distilling... (esc to interrupt · 0:03)');

    act(() => uiStore.update({
      queuedTurn: {
        content: 'A queued request that is intentionally much longer than forty characters',
        hasBrowserContext: false,
        hasCanvasContext: false,
        hasEditorContext: false,
        imageCount: 2,
      },
    }));
    await act(async () => {});
    expect(targets.queue).toHaveTextContent(/Queued: A queued request that is intentionally m\.\.\. · Images attached/);
    fireEvent.click(within(targets.queue).getByRole('button', { name: 'Edit queued message' }));
    fireEvent.click(within(targets.queue).getByRole('button', { name: 'Discard queued message' }));
    expect(surfaceActions.editQueuedTurn).toHaveBeenCalledTimes(1);
    expect(surfaceActions.discardQueuedTurn).toHaveBeenCalledTimes(1);

    act(() => uiStore.update({
      usage: {
        // contextTokens includes cached prompt input and drives the context meter.
        contextTokens: 980,
        contextWindow: 1000,
        inputTokens: 900,
        outputTokenLimit: 100,
        outputTokens: 25,
        percentage: 98,
        contextTokensIsAuthoritative: true,
        contextEnvelope: {
          checkpoints: { source: 'estimated', tokens: 30 },
          compactionReserve: { source: 'estimated', tokens: 100 },
          compactionTriggerTokens: 600,
          contextWindow: { source: 'authoritative', tokens: 1_000 },
          estimatedInputTokens: 640,
          pressureInputTokens: 980,
          recentConversation: { source: 'estimated', tokens: 400 },
          reservedOutput: { source: 'estimated', tokens: 100 },
          safetyMargin: { source: 'estimated', tokens: 50 },
          selectedContext: { source: 'estimated', tokens: 60 },
          system: { source: 'estimated', tokens: 100 },
          toolAndAgentResults: { source: 'estimated', tokens: 50 },
          total: { source: 'authoritative', tokens: 980 },
          usableInputTokens: 750,
        },
      },
    }));
    const usageTrigger = within(targets.composer).getByLabelText('980 / 1K (98%)');
    expect(usageTrigger).toHaveClass('warning');
    expect(usageTrigger.tagName).toBe('SPAN');
    expect(usageTrigger).toHaveAttribute('data-tooltip', '980 / 1K (98%)');
    expect(
      targets.composer.querySelector('path.pivi-meter-fill-input'),
    ).toHaveAttribute('stroke-dashoffset', '0');
    fireEvent.click(usageTrigger);
    expect(within(targets.composer).queryByRole('dialog')).toBeNull();
    expect(targets.composer.querySelector('path.pivi-meter-bg')?.getAttribute('d')).toBe('M 1.94 11.5 A 7 7 0 1 1 14.06 11.5');
    expect(within(targets.composer).queryByLabelText(/Output /)).toBeNull();
    expect(targets.composer.querySelector('.pivi-context-meter-gauge-output')).toBeNull();
    expect(targets.composer.querySelectorAll('.pivi-context-meter-gauge')).toHaveLength(1);
    expect(targets.composer.querySelector('.pivi-input-action-group .pivi-context-meter')).not.toBeNull();

    act(() => uiStore.update({
      usage: {
        contextTokens: 800,
        contextWindow: 1000,
        inputTokens: 800,
        outputTokenLimit: 200,
        outputTokens: 40,
        percentage: 80,
        contextEnvelope: calculateContextEnvelope({
          contextWindow: 1000,
          contextWindowIsAuthoritative: true,
          providerContextTokens: 480,
        }),
      },
    }));
    expect(within(targets.composer).getByLabelText('800 / 1K (80%)')).not.toHaveClass('warning');

    act(() => uiStore.update({
      usage: {
        contextTokens: 810,
        contextWindow: 1000,
        inputTokens: 810,
        outputTokenLimit: 200,
        outputTokens: 40,
        percentage: 81,
        contextEnvelope: calculateContextEnvelope({
          contextWindow: 1000,
          contextWindowIsAuthoritative: true,
          providerContextTokens: 486,
        }),
      },
    }));
    expect(within(targets.composer).getByLabelText('810 / 1K (81%)')).toHaveClass('warning');

    act(() => uiStore.update({
      usage: {
        contextTokens: 980,
        contextWindow: 0,
        inputTokens: 810,
        outputTokenLimit: 200,
        outputTokens: 40,
        percentage: 0,
      },
    }));
    const unknownContextMeter = within(targets.composer).getByLabelText(
      'Unable to determine the context length for the current model.',
    );
    expect(unknownContextMeter).toHaveClass('unknown');
    expect(unknownContextMeter).toHaveTextContent('!');

    act(() => uiStore.update({
      usage: {
        contextTokens: 980,
        contextWindow: 1000,
        inputTokens: 0,
        outputTokenLimit: 200,
        outputTokens: 40,
        percentage: 0,
        contextEnvelope: calculateContextEnvelope({
          contextWindow: 1000,
          contextWindowIsAuthoritative: true,
          providerContextTokens: 980,
        }),
      },
    }));
    expect(within(targets.composer).getByLabelText('980 / 1K (98%)')).toHaveClass('warning');

    act(() => uiStore.update({
      usage: {
        contextTokens: 0,
        contextWindow: 1000,
        inputTokens: 0,
        outputTokenLimit: 200,
        outputTokens: 40,
        percentage: 0,
      },
    }));
    expect(targets.composer.querySelector('.pivi-context-meter')).toBeNull();

    act(() => uiStore.update({
      currentTodoVisualizationModel: {
        activeItemId: 'in-progress',
        items: [
          { content: 'Completed task', id: 'completed', status: 'completed' },
          { activeForm: 'Writing the focused test', content: 'Write test', id: 'in-progress', status: 'in_progress' },
        ],
        progress: { completed: 1, inProgress: 1, pending: 0, total: 2 },
        source: 'manual',
      },
    }));
    const todoToggle = within(targets.todo).getByRole('button', {
      name: 'Collapse task list - 1 of 2 completed',
    });
    expect(targets.todo).toHaveTextContent('Writing the focused test');
    fireEvent.click(todoToggle);
    expect(targets.todo.querySelector('.pivi-status-panel-content')).toBeNull();
    expect(within(targets.todo).getByRole('button', {
      name: 'Expand task list - 1 of 2 completed',
    })).toBeTruthy();

    act(() => uiStore.update({ autoScrollEnabled: false, navigationVisible: true }));
    fireEvent.click(within(targets.navigation).getByRole('button', { name: 'Scroll to top' }));
    fireEvent.click(within(targets.navigation).getByRole('button', { name: 'Previous message' }));
    fireEvent.click(within(targets.navigation).getByRole('button', { name: 'Next message' }));
    fireEvent.click(within(targets.navigation).getByRole('button', { name: 'Scroll to bottom' }));
    fireEvent.click(within(targets.navigation).getByRole('button', { name: 'Resume auto-scroll' }));
    expect(surfaceActions.scrollToTop).toHaveBeenCalledTimes(1);
    expect(surfaceActions.scrollToPreviousUserMessage).toHaveBeenCalledTimes(1);
    expect(surfaceActions.scrollToNextUserMessage).toHaveBeenCalledTimes(1);
    expect(surfaceActions.scrollToBottom).toHaveBeenCalledTimes(1);
    expect(surfaceActions.resumeAutoScroll).toHaveBeenCalledTimes(1);

    await act(async () => mounted.mounted.dispose());
    bridge.dispose();
    targets.remove();
  });

  it('moves active chat portals to the new tab and stops projecting the previous tab store', async () => {
    const bridge = new ActiveChatUiBridge();
    const firstStore = new ChatUiStore();
    const secondStore = new ChatUiStore();
    const firstProjection = new ChatProjectionStore();
    const secondProjection = new ChatProjectionStore();
    const firstActivity = jest.spyOn(firstProjection, 'setSurfaceActive');
    const secondActivity = jest.spyOn(secondProjection, 'setSurfaceActive');
    const firstTargets = createPortalTargets();
    const secondTargets = createPortalTargets();
    bridge.setActive(firstStore, firstProjection, firstTargets);
    const mounted = await mountShell({ activeChat: bridge, position: 'header' });

    act(() => firstStore.update({ welcomeGreeting: 'First tab' }));
    act(() => firstStore.update({
      queuedTurn: {
        content: 'First queued turn',
        hasBrowserContext: false,
        hasCanvasContext: false,
        hasEditorContext: false,
        imageCount: 0,
      },
    }));
    expect(firstTargets.welcome).toHaveTextContent('First tab');

    act(() => bridge.setActive(secondStore, secondProjection, secondTargets));
    expect(firstActivity).toHaveBeenCalledWith(false);
    expect(secondActivity).toHaveBeenCalledWith(true);
    expect(firstTargets.welcome).toBeEmptyDOMElement();
    expect(firstTargets.queue).toBeEmptyDOMElement();
    act(() => secondStore.update({
      queuedTurn: {
        content: 'Second queued turn',
        hasBrowserContext: false,
        hasCanvasContext: false,
        hasEditorContext: false,
        imageCount: 0,
      },
      welcomeGreeting: 'Second tab',
    }));
    expect(secondTargets.welcome).toHaveTextContent('Second tab');
    expect(secondTargets.queue).toHaveTextContent('Second queued turn');
    act(() => firstStore.update({ welcomeGreeting: 'Stale first tab' }));
    expect(firstTargets.welcome).toBeEmptyDOMElement();
    expect(secondTargets.welcome).toHaveTextContent('Second tab');

    await act(async () => mounted.mounted.dispose());
    bridge.dispose();
    firstTargets.remove();
    secondTargets.remove();
  });
  it('delegates React composer actions through the active tab bridge', async () => {
    const bridge = new ActiveChatUiBridge();
    const uiStore = new ChatUiStore();
    const projectionStore = new ChatProjectionStore();
    const targets = createPortalTargets();
    const composerActions = {
      send: jest.fn(),
      stop: jest.fn(),
      setModel: jest.fn(),
      setMode: jest.fn(),
      setThinkingBudget: jest.fn(),
      setThinkingLevel: jest.fn(),
      toggleExternalPath: jest.fn(),
      toggleExternalPinned: jest.fn(),
      removeExternalPath: jest.fn(),
      addExternalContext: jest.fn(),
    };
    act(() => {
      uiStore.update({
        composer: {
          canSend: true,
          model: 'model-a',
          modelOptions: [
            { label: 'Model A', providerLogoSlug: 'anthropic', value: 'model-a' },
            { fallbackIcon: 'cpu', label: 'Longer Model B Name', value: 'model-b' },
          ],
          mode: 'ask',
          modeLabel: 'Ask',
          modeOptions: [{ label: 'Ask', value: 'ask' }, { label: 'Code', value: 'code' }],
          modeActiveValue: 'code',
          adaptiveReasoning: false,
          thinkingBudget: 'low',
          thinkingLevel: 'low',
          thinkingOptions: [
            { label: 'Off', tokens: 0, value: 'off' },
            { label: 'Low', tokens: 1_000, value: 'low' },
            { label: 'Medium', tokens: 2_000, value: 'medium' },
            { label: 'High', tokens: 4_000, value: 'high' },
          ],
          defaultReasoningValue: 'low',
        },
        externalContext: {
          items: [{ path: '/tmp/context', displayPath: '/tmp/context', checked: true, pinned: false, available: true, unavailableReason: null }],
          selectedCount: 1,
          availableSelectedCount: 1,
        },
      });
      bridge.setActive(uiStore, projectionStore, targets, composerActions);
    });
    const mounted = await mountShell({ activeChat: bridge, position: 'header' });
    await act(async () => {});
    expect(targets.composer.querySelector('.pivi-external-context-dropdown')).not.toBeNull();
    expect(targets.composer.querySelector('.pivi-external-context-btn')).not.toBeNull();
    expect(targets.composer.querySelector('.pivi-external-context-count')?.textContent).toBe('1');
    expect(targets.composer.querySelector('.pivi-mcp-selector')).toBeNull();
    fireEvent.mouseEnter(targets.composer.querySelector('.pivi-external-context-selector')!);
    fireEvent.click(within(targets.composer).getByRole('checkbox', { name: 'External context /tmp/context' }));
    expect(composerActions.toggleExternalPath).toHaveBeenCalledWith('/tmp/context');
    const toolbarChildren = [...targets.composer.querySelector('.pivi-input-toolbar')!.children];
    expect(toolbarChildren.map(element => element.className)).toEqual([
      'pivi-model-selector',
      'pivi-thinking-selector',
      'pivi-external-context-selector',
      'pivi-mode-selector',
      'pivi-input-action-group',
    ]);
    expect(targets.composer.querySelector('.pivi-model-btn .pivi-provider-logo-mask')).not.toBeNull();
    expect(targets.composer.querySelector('.pivi-toolbar-label-sizer')).toBeNull();
    expect(targets.composer.querySelector('.pivi-model-btn .pivi-model-label')?.textContent).toBe('Model A');
    expect(targets.composer.querySelector('.pivi-thinking-current .pivi-thinking-label')?.textContent).toBe('Low');
    // Composer chrome owns the toolbar portal; labels use natural width (no fixed sizer).
    expect(targets.composer.querySelector('.pivi-input-toolbar')).not.toBeNull();

    const modelSelector = targets.composer.querySelector('.pivi-model-selector')!;
    const modelTrigger = within(targets.composer).getByRole('button', { name: 'Model' });
    const modelDropdown = targets.composer.querySelector('.pivi-model-dropdown')!;
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(modelDropdown).toHaveAttribute('aria-hidden', 'true');
    fireEvent.mouseEnter(modelSelector);
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Longer Model B Name' }));
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(modelDropdown).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseEnter(modelSelector);
    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Model A' }));
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(composerActions.setModel).toHaveBeenCalledWith('model-a');

    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Ask' }));

    const thinkingGears = targets.composer.querySelector('.pivi-thinking-gears')!;
    const thinkingTrigger = within(targets.composer).getByRole('button', { name: 'Reasoning' });
    const thinkingOptions = targets.composer.querySelector('.pivi-thinking-options')!;
    fireEvent.mouseEnter(thinkingGears);
    expect(thinkingTrigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(targets.composer).getByRole('button', { name: 'High' }));
    expect(thinkingTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(thinkingOptions).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseEnter(thinkingGears);
    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Low' }));
    expect(thinkingTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(composerActions.setThinkingBudget).toHaveBeenCalledWith('low');

    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Send message' }));
    expect(composerActions.setModel).toHaveBeenCalledWith('model-b');
    expect(composerActions.setMode).toHaveBeenCalledWith('code');
    expect(composerActions.setThinkingBudget).toHaveBeenCalledWith('high');
    expect(composerActions.send).toHaveBeenCalledTimes(1);
    act(() => uiStore.update({
      composer: {
        ...uiStore.getSnapshot().composer,
        canSend: false,
        model: 'model-b',
        thinkingBudget: 'high',
      },
    }));
    expect(targets.composer.querySelector('.pivi-model-btn .pivi-model-label')?.textContent).toBe('Longer Model B Name');
    expect(targets.composer.querySelector('.pivi-thinking-current .pivi-thinking-label')?.textContent).toBe('High');
    expect(targets.composer.querySelector('.pivi-toolbar-label-slot')).toBeNull();
    expect(within(targets.composer).getByRole('button', { name: 'Enter a message to send' })).toBeDisabled();

    act(() => uiStore.update({ isStreaming: true }));
    fireEvent.click(within(targets.composer).getByRole('button', { name: 'Stop response' }));
    expect(composerActions.stop).toHaveBeenCalledTimes(1);

    await act(async () => mounted.mounted.dispose());
    bridge.dispose();
    targets.remove();
  });

});
