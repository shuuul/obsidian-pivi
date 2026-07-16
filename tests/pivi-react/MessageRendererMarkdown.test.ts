import { Component, MarkdownRenderer, TFile, TFolder } from 'obsidian';

import {
  type MessageRendererMarkdownHost,
  renderMarkdownContent,
  renderUserMessageText,
} from '@/ui/chat/rendering/messageRendererMarkdown';

function createHost(
  openLinkText = jest.fn(),
  vaultEntries: Array<TFile | TFolder> = [],
): MessageRendererMarkdownHost {
  return {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => (
          vaultEntries.find((entry) => entry.path === path) ?? null
        ),
        getAllLoadedFiles: () => vaultEntries,
        getFiles: () => vaultEntries.filter((entry): entry is TFile => entry instanceof TFile),
      },
      workspace: {
        getActiveFile: () => null,
        openLinkText,
      },
    },
    component: new Component(),
    plugin: {},
    ports: {
      catalog: {
        listMcpServers: () => [],
        listSkills: () => [],
      },
      settings: {
        getSettingsSnapshot: () => ({ externalReadDirectories: [] }),
      },
    },
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

function createVaultFile(path: string): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    extension: name.split('.').pop() ?? '',
  });
  return file;
}

function createVaultFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, {
    path,
    name: path.split('/').pop() ?? path,
  });
  return folder;
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

describe('restored user message context', () => {
  it('supplements only the first-turn auto-attached current-note badge', async () => {
    const openLinkText = jest.fn();
    const host = createHost(openLinkText);
    const container = document.createElement('div');
    const renderContent = jest.fn(async (target: HTMLElement, markdown: string) => {
      target.textContent = markdown;
    });

    await renderUserMessageText(host, container, 'Inspect these notes', {
      text: 'Inspect these notes',
      currentNotePath: 'wiki/Han Lee.md',
      attachedFilePaths: ['wiki/Han Lee.md', 'daily/2026-07-16.md'],
    }, renderContent);

    const badges = [...container.querySelectorAll<HTMLElement>('.pivi-context-badge')];
    expect(badges).toHaveLength(1);
    expect(badges.map(badge => badge.textContent)).toEqual(['Han Lee.md']);
    expect(container).toHaveTextContent('Inspect these notes');

    badges[0]?.click();
    expect(openLinkText).toHaveBeenCalledWith('wiki/Han Lee.md', '');
  });

  it('renders a folder from the input without listing its expanded context files', async () => {
    const folder = createVaultFolder('notes');
    const host = createHost(jest.fn(), [
      folder,
      createVaultFile('notes/a.md'),
      createVaultFile('notes/sub/b.md'),
    ]);
    const container = document.createElement('div');
    const renderContent = jest.fn(async (target: HTMLElement, markdown: string) => {
      target.textContent = markdown;
    });

    await renderUserMessageText(host, container, 'Review @notes/', {
      text: 'Review @notes/',
      attachedFilePaths: ['notes/a.md', 'notes/sub/b.md'],
    }, renderContent);

    const badges = [...container.querySelectorAll<HTMLElement>('.pivi-context-badge')];
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveClass('pivi-context-badge-kind-folder');
    expect(badges[0]).toHaveTextContent('notes');
    expect(container).not.toHaveTextContent('a.md');
    expect(container).not.toHaveTextContent('b.md');
    expect(container.querySelector('.pivi-user-context-badges')).toBeNull();
  });
});
