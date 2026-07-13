import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import { TOOL_OBSIDIAN_EDIT } from '@pivi/pivi-agent-core/tools/obsidianToolNames';
import { TOOL_ASK_USER_QUESTION, TOOL_BASH, TOOL_EDIT, TOOL_READ, TOOL_WRITE } from '@pivi/pivi-agent-core/tools/toolNames';
import { fireEvent, render } from '@testing-library/react';

import { createI18n, I18nProvider } from '../../packages/pivi-react/src/i18n';
import {
  AssistantContentView,
  isAssistantToolOnlyMessage,
  messageHasVisibleAssistantContent,
} from '../../packages/pivi-react/src/chat/messages/AssistantContentView';
import type { MessageContentAdapter, MessageContentAdapters } from '../../packages/pivi-react/src/chat/messages/types';
import { withTestPresentationPlatform } from '../helpers/presentationPlatform';

function renderAssistant(message: ChatMessage, contentAdapters?: MessageContentAdapters) {
  return render(withTestPresentationPlatform(
    <I18nProvider i18n={createI18n()}>
      <AssistantContentView contentAdapters={contentAdapters} message={message} />
    </I18nProvider>,
  ));
}

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

describe('AssistantContentView', () => {
  it('uses shared response metadata typography for the duration footer', () => {
    const { container } = renderAssistant(assistantMessage({
      content: 'Done',
      durationFlavorWord: 'Distilled',
      durationSeconds: 202,
    }));

    expect(container.querySelector('.pivi-baked-duration')).toHaveClass('pivi-response-meta');
    expect(container.querySelector('.pivi-response-footer')).toHaveTextContent('Distilled for 3:22');
  });

  it('keeps content blocks ordered, resolves referenced tools by id, then renders orphan tools', () => {
    const { container } = renderAssistant(assistantMessage({
      contentBlocks: [
        { type: 'text', content: 'Before' },
        { type: 'tool_use', toolId: 'known' },
        { type: 'thinking', content: 'Reasoning' },
        { type: 'context_compacted' },
        { type: 'text', content: 'After' },
      ],
      toolCalls: [
        { id: 'known', name: 'read', input: { path: 'known.md' }, status: 'completed' },
        { id: 'orphan', name: 'read', input: { path: 'orphan.md' }, status: 'completed' },
      ],
    }));

    const sequence = [...container.querySelectorAll('.pivi-text-block, .pivi-tool-call, .pivi-thinking-block, .pivi-compact-boundary')]
      .map(element => element.className.includes('pivi-text-block') ? element.textContent : element.getAttribute('data-tool-id') ?? element.className);
    expect(sequence).toEqual([
      'Before',
      'known',
      'pivi-thinking-block',
      'pivi-compact-boundary',
      'After',
      'orphan',
    ]);
  });

  it('merges Write and edit tool uses into contiguous step groups', () => {
    const { container, getByRole } = renderAssistant(assistantMessage({
      contentBlocks: [
        { type: 'tool_use', toolId: 'bash-1' },
        { type: 'tool_use', toolId: 'edit-1' },
        { type: 'tool_use', toolId: 'write-1' },
        { type: 'tool_use', toolId: 'obsidian-edit-1' },
        { type: 'tool_use', toolId: 'read-1' },
      ],
      toolCalls: [
        { id: 'bash-1', name: TOOL_BASH, input: { command: 'pwd' }, status: 'completed' },
        { id: 'edit-1', name: TOOL_EDIT, input: { file_path: 'a.md' }, status: 'completed' },
        { id: 'write-1', name: TOOL_WRITE, input: { file_path: 'b.md' }, status: 'completed' },
        { id: 'obsidian-edit-1', name: TOOL_OBSIDIAN_EDIT, input: { path: 'c.md' }, status: 'completed' },
        { id: 'read-1', name: TOOL_READ, input: { file_path: 'a.md' }, status: 'completed' },
      ],
    }));

    expect(container.querySelector('.pivi-tool-step-group')).not.toBeNull();
    const groupHeader = getByRole('button', { name: /5 steps/ });
    expect(groupHeader).toHaveAccessibleName('5 steps, Bash, Edit, Write, Read');
    expect(container.querySelector('.pivi-tool-step-group-summary')).toHaveTextContent('Bash, Edit, Write, Read');
    expect(groupHeader.textContent).not.toContain('pwd');
    expect(groupHeader.textContent).not.toContain('a.md');
    fireEvent.click(groupHeader);
    expect([...container.querySelectorAll('[data-tool-id]')].map(row => row.getAttribute('data-tool-id')))
      .toEqual(['bash-1', 'edit-1', 'write-1', 'obsidian-edit-1', 'read-1']);
  });

  it('mounts each markdown block in its own empty React slot and cleans up stale generations', () => {
    const mounts: string[] = [];
    const cleanups: string[] = [];
    const markdown: MessageContentAdapter<string> = {
      mount(container, value, context) {
        expect(container.childElementCount).toBe(0);
        mounts.push(`${value}:${context.generation}`);
        container.textContent = `rendered:${value}`;
        return () => cleanups.push(context.generation);
      },
    };
    const first = assistantMessage({ contentBlocks: [{ type: 'text', content: 'one' }, { type: 'text', content: 'two' }] });
    const rendered = renderAssistant(first, { markdown });

    expect(rendered.container.textContent).toContain('rendered:one');
    expect(rendered.container.textContent).toContain('rendered:two');
    rendered.rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <AssistantContentView contentAdapters={{ markdown }} message={assistantMessage({ contentBlocks: [{ type: 'text', content: 'three' }] })} />
      </I18nProvider>,
    ));

    expect(cleanups).toEqual(expect.arrayContaining(['assistant-1:text:0:one', 'assistant-1:text:1:two']));
    expect(mounts).toContain('three:assistant-1:text:0:three');
  });

  it('uses the pending ask-user adapter but renders completed results as readable React fallback', () => {
    const askUser: MessageContentAdapter<NonNullable<ChatMessage['toolCalls']>[number]> = {
      mount(container) {
        container.textContent = 'Interactive question';
      },
    };
    const { container, getByRole, rerender } = renderAssistant(assistantMessage({
      contentBlocks: [{ type: 'tool_use', toolId: 'ask' }],
      toolCalls: [{ id: 'ask', name: TOOL_ASK_USER_QUESTION, input: {}, status: 'running' }],
    }), { askUser });
    fireEvent.click(getByRole('button'));
    expect(container.textContent).toContain('Interactive question');

    rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <AssistantContentView message={assistantMessage({
          contentBlocks: [{ type: 'tool_use', toolId: 'ask' }],
          toolCalls: [{ id: 'ask', name: TOOL_ASK_USER_QUESTION, input: {}, status: 'completed', result: 'chosen answer' }],
        })} />
      </I18nProvider>,
    ));
    expect(container.textContent).toContain('chosen answer');
  });

  it('hides internal tools from rows and groups while preserving visible orphan order', () => {
    const { container } = renderAssistant(assistantMessage({
      contentBlocks: [
        { type: 'tool_use', toolId: 'hidden-output' },
        { type: 'tool_use', toolId: 'read-1' },
        { type: 'tool_use', toolId: 'silent-stdin' },
        { type: 'tool_use', toolId: 'custom-out' },
        { type: 'tool_use', toolId: 'read-2' },
      ],
      toolCalls: [
        { id: 'hidden-output', name: 'TaskOutput', input: {}, status: 'completed' },
        { id: 'read-1', name: 'read', input: { path: 'a.md' }, status: 'completed' },
        { id: 'silent-stdin', name: 'write_stdin', input: {}, status: 'completed' },
        { id: 'custom-out', name: 'custom_tool_call_output', input: {}, status: 'completed' },
        { id: 'read-2', name: 'read', input: { path: 'b.md' }, status: 'completed' },
        { id: 'orphan-hidden', name: 'TaskOutput', input: {}, status: 'completed' },
        { id: 'orphan-visible', name: 'read', input: { path: 'c.md' }, status: 'completed' },
      ],
    }));

    const toolIds = [...container.querySelectorAll('[data-tool-id]')].map(el => el.getAttribute('data-tool-id'));
    expect(toolIds).toEqual(['read-1', 'read-2', 'orphan-visible']);
    expect(container.querySelector('.pivi-tool-step-group')).toBeNull();
  });

  it('ignores whitespace text/thinking for visibility and does not mark subagent/write as tool-only', () => {
    expect(messageHasVisibleAssistantContent(assistantMessage({
      content: '   ',
      contentBlocks: [{ type: 'thinking', content: '  ' }],
    }))).toBe(false);

    expect(isAssistantToolOnlyMessage(assistantMessage({
      contentBlocks: [{ type: 'tool_use', toolId: 'bash-1' }],
      toolCalls: [{ id: 'bash-1', name: 'Bash', input: { command: 'ls' }, status: 'completed' }],
    }))).toBe(true);

    expect(isAssistantToolOnlyMessage(assistantMessage({
      contentBlocks: [{ type: 'tool_use', toolId: 'write-1' }],
      toolCalls: [{ id: 'write-1', name: 'Write', input: { file_path: 'a.md' }, status: 'completed' }],
    }))).toBe(true);

    expect(isAssistantToolOnlyMessage(assistantMessage({
      contentBlocks: [{ type: 'tool_use', toolId: 'edit-1' }],
      toolCalls: [{ id: 'edit-1', name: TOOL_EDIT, input: { file_path: 'a.md' }, status: 'completed' }],
    }))).toBe(true);

    expect(isAssistantToolOnlyMessage(assistantMessage({
      contentBlocks: [{ type: 'subagent', subagentId: 'sub-1', mode: 'sync' }],
      toolCalls: [{
        id: 'sub-1',
        name: 'Task',
        input: {},
        status: 'completed',
        subagent: {
          id: 'sub-1',
          description: 'helper',
          isExpanded: false,
          status: 'completed',
          toolCalls: [],
        },
      }],
    }))).toBe(false);
  });

  it('renders a subagent activity directly without a spawn-agent tool shell', () => {
    const subagentAdapter: NonNullable<MessageContentAdapters['subagent']> = {
      mount(container, subagent) {
        const activity = container.ownerDocument.createElement('div');
        activity.className = 'pivi-subagent-activity-item';
        const icon = container.ownerDocument.createElement('span');
        icon.className = 'pivi-subagent-icon';
        const label = container.ownerDocument.createElement('span');
        label.className = 'pivi-subagent-label';
        label.textContent = subagent.writerName ?? '';
        const summary = container.ownerDocument.createElement('span');
        summary.className = 'pivi-subagent-step-summary';
        summary.textContent = subagent.description;
        activity.append(icon, label, summary);
        container.appendChild(activity);
      },
    };
    const { container } = renderAssistant(assistantMessage({
      contentBlocks: [{ type: 'subagent', subagentId: 'spawn-1', mode: 'async' }],
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: { label: 'scan-links', message: 'Scan the assigned notes.' },
        status: 'running',
        subagent: {
          id: 'spawn-1',
          writerName: 'Austen',
          description: 'Scan project links',
          isExpanded: false,
          mode: 'async',
          status: 'running',
          asyncStatus: 'running',
          toolCalls: [],
        },
      }],
    }), { subagent: subagentAdapter });

    expect(container.querySelector('.pivi-subagent-content-adapter')).not.toBeNull();
    expect(container.querySelector('.pivi-subagent-icon')).not.toBeNull();
    expect(container.querySelector('.pivi-subagent-label')).toHaveTextContent('Austen');
    expect(container.querySelector('.pivi-subagent-step-summary')).toHaveTextContent('Scan project links');
    expect(container.querySelector('.pivi-tool-call')).toBeNull();
    expect(container.querySelector('.pivi-tool-header')).toBeNull();
  });
});
