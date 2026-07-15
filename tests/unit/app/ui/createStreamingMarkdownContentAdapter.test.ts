/** @jest-environment jsdom */

import { Component } from 'obsidian';
import type { ChatPerfRecorder } from '@pivi/pivi-react';

import {
  createStreamingMarkdownContentAdapter,
  findStreamingMarkdownSealOffset,
} from '@/app/ui/createStreamingMarkdownContentAdapter';

async function flushRenderQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createStreamingMarkdownContentAdapter', () => {
  it('seals safe prefixes once and appends the live tail as escaped text', async () => {
    const parent = new Component();
    const renderContent = jest.fn(async (target: HTMLElement, markdown: string) => {
      target.textContent = `rendered:${markdown}`;
    });
    const adapter = createStreamingMarkdownContentAdapter(parent, renderContent);
    const container = document.createElement('div');
    const dispose = adapter.mount(container, {
      blockId: 'block-1',
      content: 'Settled paragraph.\n\n**live',
      phase: 'streaming',
    }, { generation: 'block-1', ownerDocument: document, ownerWindow: window });
    await flushRenderQueue();

    expect(renderContent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pivi-streaming-markdown-sealed')?.textContent).toContain('Settled paragraph.');
    expect(container.querySelector('.pivi-streaming-markdown-tail')?.textContent).toBe('**live');
    expect(container.querySelector('strong')).toBeNull();

    adapter.update?.(container, {
      blockId: 'block-1',
      content: 'Settled paragraph.\n\n**live tail**',
      phase: 'streaming',
    }, { generation: 'block-1', ownerDocument: document, ownerWindow: window });
    expect(renderContent).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pivi-streaming-markdown-tail')?.textContent).toBe('**live tail**');
    dispose?.();
    expect(container.childElementCount).toBe(0);
  });

  it('does not seal an unclosed fence or display-math block', () => {
    expect(findStreamingMarkdownSealOffset('```ts\nconst x = 1;\n\n')).toBe(0);
    expect(findStreamingMarkdownSealOffset('$$\nx + y\n\n')).toBe(0);
    expect(findStreamingMarkdownSealOffset('> [!note]\n> body\n\nnext')).toBe(
      '> [!note]\n> body\n\n'.length,
    );
  });

  it('keeps a 100KB unclosed code fence entirely in the plain-text tail', () => {
    const markdown = `\`\`\`text\n${'x'.repeat(100_000)}`;
    expect(findStreamingMarkdownSealOffset(markdown)).toBe(0);
  });

  it('rebuilds rewrites and performs one full fidelity render at terminal state', async () => {
    const parent = new Component();
    const removeChild = jest.spyOn(parent, 'removeChild');
    const renderContent = jest.fn(async (target: HTMLElement, markdown: string) => {
      target.textContent = markdown;
    });
    const adapter = createStreamingMarkdownContentAdapter(parent, renderContent);
    const container = document.createElement('div');
    const context = { generation: 'block-1', ownerDocument: document, ownerWindow: window };
    adapter.mount(container, { blockId: 'block-1', content: 'old\n\ntail', phase: 'streaming' }, context);
    await flushRenderQueue();

    adapter.update?.(container, { blockId: 'block-1', content: 'rewritten', phase: 'streaming' }, context);
    expect(container.querySelector('.pivi-streaming-markdown-tail')?.textContent).toBe('rewritten');
    adapter.update?.(container, { blockId: 'block-1', content: '# Final', phase: 'terminal' }, context);
    await flushRenderQueue();

    expect(renderContent).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      '# Final',
      expect.objectContaining({ component: expect.any(Component) }),
    );
    expect(container.textContent).toContain('# Final');
    expect(removeChild).toHaveBeenCalled();
  });

  it('reports the duration of actual Markdown renders', async () => {
    let now = 0;
    const recorder: ChatPerfRecorder = {
      enabled: true,
      now: jest.fn(() => {
        now += 3;
        return now;
      }),
      onMarkdownRender: jest.fn(),
      onProjectionCommit: jest.fn(),
      onProjectionEvent: jest.fn(),
      onProjectionPaint: jest.fn(),
      onScrollAnchor: jest.fn(),
      onVirtualRows: jest.fn(),
    };
    const adapter = createStreamingMarkdownContentAdapter(
      new Component(),
      async (target, markdown) => {
        target.textContent = markdown;
      },
      recorder,
    );
    const container = document.createElement('div');

    adapter.mount(container, {
      blockId: 'block-measured',
      content: '# Complete',
      phase: 'terminal',
    }, { generation: 'block-measured', ownerDocument: document, ownerWindow: window });
    await flushRenderQueue();

    expect(recorder.onMarkdownRender).toHaveBeenCalledWith(
      'block-measured',
      'terminal',
      '# Complete'.length,
      3,
      window,
    );
  });
});
