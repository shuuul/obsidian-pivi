import { Component, MarkdownRenderer } from 'obsidian';

import { renderMarkdownContent } from '@/ui/chat/rendering/messageRendererMarkdown';
import { createContextBadgeElement } from '@/ui/shared/context-badge/ContextBadgeRenderer';
import { createChatIconSvg } from '@/ui/shared/utils/icons';

import { installObsidianDomHelpers } from '../setupObsidianUi';

describe('owner-realm DOM creation', () => {
  let iframe: HTMLIFrameElement;
  let ownerDocument: Document;
  let ownerWindow: Window;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    ownerDocument = iframe.contentDocument!;
    ownerWindow = iframe.contentWindow!;
    installObsidianDomHelpers(ownerWindow);
    jest.mocked(MarkdownRenderer.render).mockReset();
  });

  afterEach(() => iframe.remove());

  it('keeps Markdown enhancement nodes in the popout document', async () => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, _markdown, target) => {
      const pre = ownerDocument.createElement('pre');
      const code = ownerDocument.createElement('code');
      code.className = 'language-typescript';
      pre.append(code);
      target.appendChild(pre);
    });
    const container = ownerWindow.createDiv();
    ownerDocument.body.appendChild(container);

    await renderMarkdownContent({
      app: {
        workspace: { getActiveFile: () => null },
      },
      component: new Component(),
    } as never, container, '```ts\nconst value = 1;\n```');

    const wrapper = container.querySelector('.pivi-code-wrapper');
    expect(wrapper?.ownerDocument).toBe(ownerDocument);
    expect(container.querySelector('.pivi-code-lang-label')?.ownerDocument).toBe(ownerDocument);
  });

  it('creates context badges and SVG icons in the popout document', () => {
    const root = ownerWindow.createDiv();
    ownerDocument.body.appendChild(root);
    const badge = createContextBadgeElement({
      kind: 'mcp',
      token: '/notes',
      serverName: 'notes',
    }, { root });
    const icon = createChatIconSvg({
      kind: 'path',
      path: 'M0 0h1v1z',
      viewBox: '0 0 1 1',
    }, { ownerDocument });

    expect(badge.ownerDocument).toBe(ownerDocument);
    expect(badge.querySelector('svg')?.ownerDocument).toBe(ownerDocument);
    expect(icon.ownerDocument).toBe(ownerDocument);
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });
});
