import type { ChatSettingsPort } from '@pivi/pivi-agent-core/runtime/chatPorts';

import { wireMessageViewport } from '@/ui/chat/tabs/tabMessageViewport';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  disconnected = false;
  observed: unknown[] = [];

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: unknown): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  trigger(): void {
    this.callback();
  }
}

interface FakeMessageElement {
  clientHeight: number;
  contains: jest.Mock;
  find: jest.Mock;
  ownerDocument: {
    activeElement: { closest: jest.Mock } | null;
    defaultView: { ResizeObserver?: typeof FakeResizeObserver } | null;
  };
  scrollHeight: number;
  scrollTop: number;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
}

function createMessageElement(withObserver = true): FakeMessageElement {
  return {
    clientHeight: 100,
    contains: jest.fn(() => false),
    find: jest.fn(() => null),
    ownerDocument: {
      activeElement: null,
      defaultView: withObserver ? { ResizeObserver: FakeResizeObserver } : {},
    },
    scrollHeight: 300,
    scrollTop: 80,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

function createSettings(enableAutoScroll: boolean): ChatSettingsPort {
  return {
    getSettingsSnapshot: () => ({ enableAutoScroll }),
  } as ChatSettingsPort;
}

describe('wireMessageViewport', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
  });

  it('follows async content growth while auto-scroll is enabled', () => {
    const messagesEl = createMessageElement();
    const messagesPortalEl = {};
    const state = { autoScrollEnabled: true, navigationVisible: false };

    const cleanup = wireMessageViewport({
      messagesEl: messagesEl as unknown as HTMLElement,
      messagesPortalEl: messagesPortalEl as HTMLElement,
      settings: createSettings(true),
      state,
    });

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]?.observed).toEqual([
      messagesEl,
      messagesPortalEl,
    ]);

    messagesEl.scrollHeight = 480;
    FakeResizeObserver.instances[0]?.trigger();

    expect(messagesEl.scrollTop).toBe(480);
    expect(state.navigationVisible).toBe(true);

    cleanup();
    expect(messagesEl.removeEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
    );
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
  });

  it.each([
    ['the user has scrolled up', false, true],
    ['the setting is disabled', true, false],
  ])('does not pull the viewport back when %s', (_label, autoScrollEnabled, settingEnabled) => {
    const messagesEl = createMessageElement();
    const state = { autoScrollEnabled, navigationVisible: false };
    wireMessageViewport({
      messagesEl: messagesEl as unknown as HTMLElement,
      messagesPortalEl: {} as HTMLElement,
      settings: createSettings(settingEnabled),
      state,
    });

    messagesEl.scrollHeight = 480;
    FakeResizeObserver.instances[0]?.trigger();

    expect(messagesEl.scrollTop).toBe(80);
    expect(state.navigationVisible).toBe(true);
  });

  it('does not pull the viewport while the user interacts with a subagent', () => {
    const messagesEl = createMessageElement();
    messagesEl.find.mockReturnValue({});
    const state = { autoScrollEnabled: true, navigationVisible: false };
    wireMessageViewport({
      messagesEl: messagesEl as unknown as HTMLElement,
      messagesPortalEl: {} as HTMLElement,
      settings: createSettings(true),
      state,
    });

    messagesEl.scrollHeight = 480;
    FakeResizeObserver.instances[0]?.trigger();

    expect(messagesEl.scrollTop).toBe(80);
    expect(messagesEl.find).toHaveBeenCalledWith('.pivi-subagent-list:hover');
    expect(state.navigationVisible).toBe(true);
  });

  it('still tracks scroll navigation without ResizeObserver support', () => {
    const messagesEl = createMessageElement(false);
    const state = { autoScrollEnabled: true, navigationVisible: false };

    const cleanup = wireMessageViewport({
      messagesEl: messagesEl as unknown as HTMLElement,
      messagesPortalEl: {} as HTMLElement,
      settings: createSettings(true),
      state,
    });

    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(state.navigationVisible).toBe(true);
    expect(messagesEl.addEventListener).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function),
      { passive: true },
    );

    expect(cleanup).not.toThrow();
  });
});
