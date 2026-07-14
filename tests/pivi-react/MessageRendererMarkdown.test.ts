import { MarkdownRenderer } from 'obsidian';

import {
  type MessageRendererMarkdownHost,
  renderMarkdownContent,
} from '@/ui/chat/rendering/messageRendererMarkdown';

function createHost(): MessageRendererMarkdownHost {
  return {
    app: {
      workspace: {
        getActiveFile: () => null,
      },
    },
    component: {},
    plugin: {},
    ports: {},
  } as unknown as MessageRendererMarkdownHost;
}

function appendYamlBlock(target: HTMLElement, frontmatter: boolean): void {
  const pre = target.ownerDocument.createElement('pre');
  if (frontmatter) pre.classList.add('frontmatter');
  const code = target.ownerDocument.createElement('code');
  code.className = 'language-yaml';
  code.textContent = ['title', 'Example'].join(': ');
  pre.appendChild(code);
  const copyButton = target.ownerDocument.createElement('button');
  copyButton.className = 'copy-code-button';
  pre.appendChild(copyButton);
  target.appendChild(pre);
}

describe('Markdown code block enhancement', () => {
  beforeEach(() => {
    jest.mocked(MarkdownRenderer.render).mockReset();
  });

  it('leaves Obsidian frontmatter placeholders hidden', async () => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, _markdown, target) => {
      appendYamlBlock(target as HTMLElement, true);
    });
    const container = document.createElement('div');

    await renderMarkdownContent(createHost(), container, '---\ntitle: Example\n---');

    expect(container.querySelector('pre.frontmatter')).not.toBeNull();
    expect(container.querySelector('.pivi-code-wrapper')).toBeNull();
    expect(container.querySelector('.pivi-code-lang-label')).toBeNull();
  });

  it('keeps enhancing explicit fenced YAML blocks', async () => {
    jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, _markdown, target) => {
      appendYamlBlock(target as HTMLElement, false);
    });
    const container = document.createElement('div');

    await renderMarkdownContent(createHost(), container, '```yaml\ntitle: Example\n```');

    expect(container.querySelector('.pivi-code-wrapper--language')).not.toBeNull();
    expect(container.querySelector('.pivi-code-lang-label')).toHaveTextContent('yaml');
  });
});
