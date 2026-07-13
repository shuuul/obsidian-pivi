import { fireEvent, render, screen } from '@testing-library/react';

import { MessageList } from '@pivi/obsidian-react/chat/messages';
import { createI18n, I18nProvider } from '@pivi/obsidian-react/i18n';
import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';

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
  render(
    <I18nProvider i18n={createI18n()}>
      <MessageList actions={actions} messages={messages} />
    </I18nProvider>,
  );
  return actions;
}

describe('MessageList', () => {
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
    render(
      <I18nProvider i18n={createI18n()}>
        <MessageList actions={actions} messages={[rebuilt]} />
      </I18nProvider>,
    );

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
    render(
      <I18nProvider i18n={createI18n()}>
        <MessageList actions={actions} messages={[message]} />
      </I18nProvider>,
    );

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

    const { container } = render(
      <I18nProvider i18n={createI18n()}>
        <MessageList
          actions={actions}
          messages={[emptyAssistant, interruptOnly, interruptWithContent, toolOnly, liveCancelAlreadyInContent]}
        />
      </I18nProvider>,
    );

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