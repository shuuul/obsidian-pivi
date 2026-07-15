import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createI18n, I18nProvider, MessageList } from '@pivi/pivi-react';
import { type ChatPerfRecorder, ChatProjectionStore } from '@pivi/pivi-react/store';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

const messages: ChatMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    content: 'Question',
    timestamp: 1,
    userMessageId: 'entry-user',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Answer',
    contentBlocks: [{ type: 'text', content: 'Answer' }],
    timestamp: 2,
    assistantMessageId: 'entry-assistant',
  },
];

const scrollElement = document.createElement('div');
Object.defineProperties(scrollElement, {
  clientHeight: { configurable: true, value: 600 },
  clientWidth: { configurable: true, value: 480 },
});

function TestMessageList({
  actions,
  isStreaming,
  messages: currentMessages,
  recorder,
}: {
  actions: Parameters<typeof MessageList>[0]['actions'];
  isStreaming: boolean;
  messages: ChatMessage[];
  recorder?: ChatPerfRecorder;
}) {
  const store = new ChatProjectionStore(recorder);
  store.replaceAll(currentMessages);
  return (
    <MessageList
      actions={actions}
      autoScrollEnabled
      isStreaming={isStreaming}
      scrollElement={scrollElement}
      store={store}
      thinkingIndicator={null}
    />
  );
}

function renderList(overrides: Partial<Parameters<typeof MessageList>[0]['actions']> = {}) {
  const actions = {
    canCopy: jest.fn(() => true),
    canFork: jest.fn((message: ChatMessage) => message.role === 'assistant'),
    canRedo: jest.fn((messageId: string) => messageId === 'assistant-1'),
    copy: jest.fn(),
    fork: jest.fn(),
    redo: jest.fn(),
    scrollToRecentUser: jest.fn(),
    ...overrides,
  };
  render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>
      <TestMessageList actions={actions} isStreaming={false} messages={messages} />
    </I18nProvider>,
  ));
  return actions;
}

describe('MessageList', () => {
  it('coalesces an asynchronous previous-page request while it is pending', async () => {
    const localScrollElement = document.createElement('div');
    Object.defineProperties(localScrollElement, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 480 },
      scrollHeight: { configurable: true, value: 12_000 },
      scrollTop: { configurable: true, value: 500, writable: true },
    });
    document.body.appendChild(localScrollElement);
    const store = new ChatProjectionStore();
    store.replaceAll(Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index}`,
      timestamp: index,
    })));
    let resolveFirst!: (loaded: boolean) => void;
    const onLoadPreviousPage = jest.fn()
      .mockReturnValueOnce(new Promise<boolean>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValue(false);
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    const rendered = render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <MessageList
          actions={actions}
          autoScrollEnabled={false}
          isStreaming={false}
          onLoadPreviousPage={onLoadPreviousPage}
          scrollElement={localScrollElement}
          store={store}
          thinkingIndicator={null}
        />
      </I18nProvider>,
    ));

    localScrollElement.scrollTop = 500;
    fireEvent.scroll(localScrollElement);
    localScrollElement.scrollTop = 0;
    fireEvent.scroll(localScrollElement);
    fireEvent.scroll(localScrollElement);
    await waitFor(() => expect(onLoadPreviousPage).toHaveBeenCalledTimes(1));

    resolveFirst(false);

    rendered.unmount();
    localScrollElement.remove();
  });

  it('keeps a 5K transcript mounted row count bounded by the viewport and overscan', () => {
    const longTranscript: ChatMessage[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${index}`,
      timestamp: index,
    }));
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    const rendered = render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList actions={actions} isStreaming={false} messages={longTranscript} />
      </I18nProvider>,
    ));

    const mountedRows = rendered.container.querySelectorAll('.pivi-message-virtual-row').length;
    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThanOrEqual(20);
  });

  it('reports mounted rows and DOM nodes through the injected recorder', () => {
    const recorder: ChatPerfRecorder = {
      enabled: true,
      now: jest.fn(() => 0),
      onMarkdownRender: jest.fn(),
      onProjectionCommit: jest.fn(),
      onProjectionEvent: jest.fn(),
      onProjectionPaint: jest.fn(),
      onScrollAnchor: jest.fn(),
      onVirtualRows: jest.fn(),
    };
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };

    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList
          actions={actions}
          isStreaming={false}
          messages={messages}
          recorder={recorder}
        />
      </I18nProvider>,
    ));

    expect(recorder.onVirtualRows).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      window,
    );
    const [mountedRows, domNodes] = (recorder.onVirtualRows as jest.Mock).mock.calls.at(-1);
    expect(mountedRows).toBeGreaterThan(0);
    expect(domNodes).toBeGreaterThan(mountedRows);
  });

  it('renders snapshot messages and delegates only eligible actions', () => {
    const actions = renderList();

    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy this agent response' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Fork conversation' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Redo agent response' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fork conversation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo agent response' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to most recent user message' }));

    expect(actions.copy).toHaveBeenCalledWith(messages[0]);
    expect(actions.fork).toHaveBeenCalledWith('assistant-1');
    expect(actions.redo).toHaveBeenCalledWith('assistant-1');
    expect(actions.scrollToRecentUser).toHaveBeenCalledTimes(1);
  });

  it('keeps historical toolbars but hides the active turn toolbars until streaming stops', () => {
    const currentMessages: ChatMessage[] = [
      ...messages,
      {
        id: 'user-current',
        role: 'user',
        content: 'Follow-up',
        timestamp: 3,
      },
      {
        id: 'assistant-current',
        role: 'assistant',
        content: 'Partial answer',
        contentBlocks: [{ type: 'text', content: 'Partial answer' }],
        timestamp: 4,
      },
    ];
    const actions = {
      canCopy: jest.fn(() => true),
      canFork: jest.fn(() => true),
      canRedo: jest.fn(() => true),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    const rendered = render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList actions={actions} isStreaming messages={currentMessages} />
      </I18nProvider>,
    ));

    expect(rendered.container.querySelector('[data-message-id="user-1"] .pivi-message-actions')).not.toBeNull();
    expect(rendered.container.querySelector('[data-message-id="assistant-1"] .pivi-message-actions')).not.toBeNull();
    expect(rendered.container.querySelector('[data-message-id="user-current"] .pivi-message-actions')).toBeNull();
    expect(rendered.container.querySelector('[data-message-id="assistant-current"] .pivi-message-actions')).toBeNull();

    rendered.rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList actions={actions} isStreaming={false} messages={currentMessages} />
      </I18nProvider>,
    ));

    expect(rendered.container.querySelector('[data-message-id="user-current"] .pivi-message-actions')).not.toBeNull();
    expect(rendered.container.querySelector('[data-message-id="assistant-current"] .pivi-message-actions')).not.toBeNull();
  });

  it('hides rebuilt context and pending actions rejected by runtime predicates', () => {
    const rebuilt: ChatMessage = {
      id: 'rebuilt',
      role: 'user',
      content: 'hidden context',
      isRebuiltContext: true,
      timestamp: 3,
    };
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList actions={actions} isStreaming={false} messages={[rebuilt]} />
      </I18nProvider>,
    ));

    expect(screen.queryByText('hidden context')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });


  it('wraps user images, opens the modal, and closes via overlay, close, and Escape', () => {
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    const message: ChatMessage = {
      id: 'user-image',
      role: 'user',
      content: '',
      timestamp: 1,
      images: [{ id: 'img-1', name: 'shot.png', mediaType: 'image/png', data: 'aaa', size: 3, source: 'paste' }],
    };
    render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList actions={actions} isStreaming={false} messages={[message]} />
      </I18nProvider>,
    ));

    const wrapper = document.querySelector('.pivi-message-images .pivi-message-image img');
    expect(wrapper).not.toBeNull();
    fireEvent.click(wrapper!);
    expect(document.querySelector('.pivi-image-modal-overlay .pivi-image-modal img')).not.toBeNull();

    fireEvent.click(document.querySelector('.pivi-image-modal-close')!);
    expect(document.querySelector('.pivi-image-modal-overlay')).toBeNull();

    fireEvent.click(wrapper!);
    fireEvent.click(document.querySelector('.pivi-image-modal-overlay')!);
    expect(document.querySelector('.pivi-image-modal-overlay')).toBeNull();

    fireEvent.click(wrapper!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.pivi-image-modal-overlay')).toBeNull();
  });

  it('hides empty assistants, shows stored interrupt indicators, and marks tool-only shells', () => {
    const actions = {
      canCopy: jest.fn(() => false),
      canFork: jest.fn(() => false),
      canRedo: jest.fn(() => false),
      copy: jest.fn(),
      fork: jest.fn(),
      redo: jest.fn(),
      scrollToRecentUser: jest.fn(),
    };
    const emptyAssistant: ChatMessage = {
      id: 'empty',
      role: 'assistant',
      content: '',
      timestamp: 1,
    };
    const interruptOnly: ChatMessage = {
      id: 'interrupt',
      role: 'assistant',
      content: '',
      isInterrupt: true,
      timestamp: 2,
    };
    const interruptWithContent: ChatMessage = {
      id: 'interrupt-content',
      role: 'assistant',
      content: 'Partial answer',
      isInterrupt: true,
      timestamp: 3,
    };
    const toolOnly: ChatMessage = {
      id: 'tool-only',
      role: 'assistant',
      content: '',
      timestamp: 4,
      contentBlocks: [{ type: 'tool_use', toolId: 'bash-1' }],
      toolCalls: [{ id: 'bash-1', name: 'Bash', input: { command: 'ls' }, status: 'completed' }],
    };
    const liveCancelAlreadyInContent: ChatMessage = {
      id: 'live-cancel',
      role: 'assistant',
      content: '',
      timestamp: 5,
      // Live cancel writes interrupt markup into a text block and does not set isInterrupt.
      contentBlocks: [{ type: 'text', content: 'Working — interrupted inline' }],
    };

    const { container } = render(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <TestMessageList
          actions={actions}
          isStreaming={false}
          messages={[emptyAssistant, interruptOnly, interruptWithContent, toolOnly, liveCancelAlreadyInContent]}
        />
      </I18nProvider>,
    ));

    expect(container.querySelector('[data-message-id="empty"]')).toBeNull();
    expect(container.querySelector('[data-message-id="interrupt"] .pivi-interrupted')).not.toBeNull();
    expect(container.querySelector('[data-message-id="interrupt-content"] .pivi-interrupted')).not.toBeNull();
    expect(container.querySelector('[data-message-id="interrupt-content"]')).toHaveTextContent('Partial answer');
    expect(container.querySelector('[data-message-id="tool-only"]')).toHaveClass('pivi-message-assistant-tool-only');
    // No stored isInterrupt => React must not append a second interrupt indicator shell.
    expect(container.querySelector('[data-message-id="live-cancel"] .pivi-interrupted')).toBeNull();
    expect(container.querySelector('[data-message-id="live-cancel"]')).toHaveTextContent('Working — interrupted inline');
  });
});
