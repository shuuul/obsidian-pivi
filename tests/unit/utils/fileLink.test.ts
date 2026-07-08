import type { App, Component, TAbstractFile, WorkspaceLeaf } from 'obsidian';

import {
  extractLinkTarget,
  normalizeObsidianAppLinksInMarkdown,
  processFileLinks,
  registerFileLinkHandler,
} from '@/ui/shared/utils/fileLink';
import { createMockApp } from '../../helpers/mockApp';

describe('fileLink utils', () => {
  describe('extractLinkTarget', () => {
    it('returns path without display alias', () => {
      expect(extractLinkTarget('[[folder/note|Display]]')).toBe('folder/note');
    });

    it('preserves heading and block refs in target', () => {
      expect(extractLinkTarget('[[note#Heading]]')).toBe('note#Heading');
      expect(extractLinkTarget('[[note^block-id]]')).toBe('note^block-id');
    });

    it('strips alias but keeps subpath', () => {
      expect(extractLinkTarget('[[note#H|Alias]]')).toBe('note#H');
    });

    it('supports embedded image syntax', () => {
      expect(extractLinkTarget('![[assets/Pasted image.png]]')).toBe('assets/Pasted image.png');
      expect(extractLinkTarget('![[assets/Pasted image.png|preview]]')).toBe('assets/Pasted image.png');
    });
  });

  describe('normalizeObsidianAppLinksInMarkdown', () => {
    it('rewrites Obsidian app markdown links as wikilinks', () => {
      expect(
        normalizeObsidianAppLinksInMarkdown('[AGENTS.md](app://obsidian.md/AGENTS.md)'),
      ).toBe('[[AGENTS.md]]');
    });

    it('preserves aliases when link text is not the file name', () => {
      expect(
        normalizeObsidianAppLinksInMarkdown('[Guide](app://obsidian.md/system/manual/Agent%20Guide.md)'),
      ).toBe('[[system/manual/Agent Guide.md|Guide]]');
    });

    it('decodes unicode paths', () => {
      expect(
        normalizeObsidianAppLinksInMarkdown('[人的意志.md](app://obsidian.md/%E4%BA%BA%E7%9A%84%E6%84%8F%E5%BF%97.md)'),
      ).toBe('[[人的意志.md]]');
    });

    it('rewrites Obsidian app image links as image embeds', () => {
      expect(
        normalizeObsidianAppLinksInMarkdown('![Preview](app://obsidian.md/assets/Pasted%20image.png)'),
      ).toBe('![[assets/Pasted image.png]]');
    });

    it('rewrites obsidian open URIs as wikilinks', () => {
      expect(
        normalizeObsidianAppLinksInMarkdown('[Note](obsidian://open?vault=Base&file=folder%2FNote.md)'),
      ).toBe('[[folder/Note.md]]');
    });
  });

  describe('registerFileLinkHandler', () => {
    it('registers click handler that opens link in workspace', () => {
      const app = createMockApp();
      app.workspace.openLinkText = jest.fn().mockResolvedValue(undefined);

      const container = {
        addEventListener: jest.fn(),
      } as unknown as HTMLElement;

      const handlers: Record<string, (event: MouseEvent) => void> = {};
      const component = {
        registerDomEvent: jest.fn((
          _el: HTMLElement,
          event: string,
          handler: (event: MouseEvent) => void,
        ) => {
          handlers[event] = handler;
        }),
      } as unknown as Component;

      registerFileLinkHandler(app as App, container, component);

      expect(component.registerDomEvent).toHaveBeenCalledWith(
        container,
        'click',
        expect.any(Function),
      );

      const link = {
        dataset: { href: 'My Note' },
        getAttribute: jest.fn(),
        closest: jest.fn().mockReturnThis(),
      } as unknown as HTMLAnchorElement;

      const event = {
        preventDefault: jest.fn(),
        target: link,
      } as unknown as MouseEvent;

      handlers.click(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(app.workspace.openLinkText).toHaveBeenCalledWith('My Note', '', 'tab');
    });

    it('reveals an existing workspace tab for an already-open wikilink target', () => {
      const noteFile = { path: 'Folder/My Note.md', basename: 'My Note' };
      const existingLeaf = {
        view: { file: noteFile },
        openFile: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkspaceLeaf;
      const app = createMockApp({ linkDest: noteFile });
      app.workspace.openLinkText = jest.fn().mockResolvedValue(undefined);
      app.workspace.revealLeaf = jest.fn().mockResolvedValue(undefined);
      app.workspace.iterateAllLeaves = jest.fn((visit: (leaf: WorkspaceLeaf) => void) => {
        visit(existingLeaf);
      });

      const container = {
        addEventListener: jest.fn(),
      } as unknown as HTMLElement;

      const handlers: Record<string, (event: MouseEvent) => void> = {};
      const component = {
        registerDomEvent: jest.fn((
          _el: HTMLElement,
          event: string,
          handler: (event: MouseEvent) => void,
        ) => {
          handlers[event] = handler;
        }),
      } as unknown as Component;

      registerFileLinkHandler(app as App, container, component);

      const link = {
        dataset: { href: 'Folder/My Note.md' },
        getAttribute: jest.fn(),
        closest: jest.fn().mockReturnThis(),
      } as unknown as HTMLAnchorElement;

      const event = {
        preventDefault: jest.fn(),
        target: link,
      } as unknown as MouseEvent;

      handlers.click(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
      expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it('opens clickable rendered embeds from app URI targets', () => {
      const app = createMockApp();
      app.workspace.openLinkText = jest.fn().mockResolvedValue(undefined);

      const container = {
        addEventListener: jest.fn(),
      } as unknown as HTMLElement;

      const handlers: Record<string, (event: MouseEvent) => void> = {};
      const component = {
        registerDomEvent: jest.fn((
          _el: HTMLElement,
          event: string,
          handler: (event: MouseEvent) => void,
        ) => {
          handlers[event] = handler;
        }),
      } as unknown as Component;

      registerFileLinkHandler(app as App, container, component);

      const embed = {
        dataset: {},
        getAttribute: jest.fn((name: string) => (
          name === 'data-href'
            ? 'app://obsidian.md/assets/Pasted%20image.png'
            : null
        )),
        closest: jest.fn().mockReturnThis(),
      } as unknown as HTMLElement;

      const event = {
        preventDefault: jest.fn(),
        target: embed,
      } as unknown as MouseEvent;

      handlers.click(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(app.workspace.openLinkText).toHaveBeenCalledWith('assets/Pasted image.png', '', 'tab');
    });
  });

  describe('processFileLinks', () => {
    class MockNode {
      parentElement: MockElement | null = null;
      ownerDocument: MockDocument;

      constructor(ownerDocument: MockDocument) {
        this.ownerDocument = ownerDocument;
      }

      get textContent(): string {
        return '';
      }

      set textContent(_value: string) {
        // Subclasses override for specific behavior.
      }
    }

    class MockElement extends MockNode {
      tagName: string;
      className = '';
      children: MockNode[] = [];
      attributes: Map<string, string> = new Map();
      private _textContent = '';

      constructor(ownerDocument: MockDocument, tagName: string) {
        super(ownerDocument);
        this.tagName = tagName.toUpperCase();
      }

      override get textContent(): string {
        return this.children.map((child) => child.textContent).join('');
      }

      override set textContent(value: string) {
        this._textContent = value;
        this.children = value ? [this.ownerDocument.createTextNode(value)] : [];
      }

      get classList() {
        return {
          add: (cls: string): void => {
            const classes = this.className.split(' ').filter(Boolean);
            if (!classes.includes(cls)) {
              classes.push(cls);
              this.className = classes.join(' ');
            }
          },
        };
      }

      addClass(cls: string): void {
        this.classList.add(cls);
      }

      getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
      }

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }

      appendChild(node: MockNode): MockNode {
        node.parentElement = this;
        this.children.push(node);
        return node;
      }

      insertBefore(node: MockNode, ref: MockNode | null): MockNode {
        node.parentElement = this;
        if (ref) {
          const idx = this.children.indexOf(ref);
          if (idx >= 0) {
            this.children.splice(idx, 0, node);
            return node;
          }
        }
        this.children.push(node);
        return node;
      }

      replaceWith(node: MockNode): void {
        if (!this.parentElement) return;
        this.parentElement.insertBefore(node, this);
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) {
          this.parentElement.children.splice(idx, 1);
        }
      }

      closest(selector: string): MockElement | null {
        let node: MockElement | null = this;
        while (node) {
          if (matchesSelector(node, selector)) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      }

      empty(): void {
        this.children = [];
      }

      querySelectorAll(selector: string): MockElement[] {
        const results: MockElement[] = [];
        for (const child of this.children) {
          if (child instanceof MockElement) {
            if (matchesSelector(child, selector)) {
              results.push(child);
            }
            results.push(...child.querySelectorAll(selector));
          }
        }
        return results;
      }
    }

    class MockTextNode extends MockNode {
      private _textContent = '';

      constructor(ownerDocument: MockDocument, text: string) {
        super(ownerDocument);
        this._textContent = text;
      }

      override get textContent(): string {
        return this._textContent;
      }

      override set textContent(value: string) {
        this._textContent = value;
      }
    }

    class MockDocumentFragment extends MockNode {
      constructor(ownerDocument: MockDocument) {
        super(ownerDocument);
      }
    }

    class MockTreeWalker {
      private root: MockElement;
      private filter: { acceptNode: (node: Node) => number } | null;
      private stack: MockNode[];
      private current: MockNode | null = null;

      constructor(
        root: MockElement,
        _whatToShow: number,
        filter: { acceptNode: (node: Node) => number } | null,
      ) {
        this.root = root;
        this.filter = filter;
        this.stack = [root];
      }

      nextNode(): MockNode | null {
        while (this.stack.length > 0) {
          const node = this.stack.shift()!;
          if (node !== this.root && node instanceof MockTextNode) {
            const result = this.filter ? this.filter.acceptNode(node as unknown as Node) : 1;
            if (result === 1) {
              this.current = node;
              return node;
            }
          }
          if (node instanceof MockElement) {
            this.stack.unshift(...node.children);
          }
        }
        return null;
      }
    }

    class MockDocument {
      createElement(tagName: string): MockElement {
        return new MockElement(this, tagName);
      }

      createTextNode(text: string): MockTextNode {
        return new MockTextNode(this, text);
      }

      createDocumentFragment(): MockDocumentFragment {
        return new MockDocumentFragment(this);
      }

      createTreeWalker(
        root: MockElement,
        whatToShow: number,
        filter: { acceptNode: (node: Node) => number } | null,
      ): MockTreeWalker {
        return new MockTreeWalker(root, whatToShow, filter);
      }
    }

    function matchesSelector(element: MockElement, selector: string): boolean {
      const selectors = selector.split(',').map((s) => s.trim());
      return selectors.some((s) => matchesSingleSelector(element, s));
    }

    function matchesSingleSelector(element: MockElement, selector: string): boolean {
      if (selector === 'code' || selector === 'pre' || selector === 'a') {
        return element.tagName.toLowerCase() === selector;
      }
      if (selector.startsWith('.')) {
        const className = selector.slice(1);
        return element.className.split(' ').includes(className);
      }
      if (selector.includes('[')) {
        return element.tagName.toLowerCase() === 'a';
      }
      return false;
    }

    function createMockAppWithVaultFiles(filePaths: string[]): App {
      const app = createMockApp();
      app.vault.getAbstractFileByPath = jest.fn((path: string) => {
        if (filePaths.includes(path)) {
          const name = path.split('/').pop() ?? path;
          const basename = name.endsWith('.md') ? name.slice(0, -3) : name;
          return { path, basename } as unknown as TAbstractFile;
        }
        return null;
      });
      return app as App;
    }

    function createContainer(html: string): MockElement {
      const doc = new MockDocument();
      const container = doc.createElement('div');
      // Minimal HTML parser for this test: supports <p>, <code>, and text nodes.
      const tagPattern = /<\/?([a-z]+)[^>]*>/g;
      let match;
      let lastIndex = 0;
      const stack: MockElement[] = [container];
      while ((match = tagPattern.exec(html)) !== null) {
        const beforeText = html.slice(lastIndex, match.index);
        if (beforeText) {
          stack[stack.length - 1].appendChild(doc.createTextNode(beforeText));
        }
        const tagName = match[1];
        const isClosing = match[0].startsWith('</');
        if (isClosing) {
          stack.pop();
        } else {
          const el = doc.createElement(tagName);
          stack[stack.length - 1].appendChild(el);
          stack.push(el);
        }
        lastIndex = tagPattern.lastIndex;
      }
      const trailingText = html.slice(lastIndex);
      if (trailingText) {
        stack[stack.length - 1].appendChild(doc.createTextNode(trailingText));
      }
      return container;
    }

    beforeAll(() => {
      // Provide NodeFilter constants for the browser APIs used by fileLink.ts.
      interface MockNodeFilter {
        SHOW_TEXT: number;
        FILTER_ACCEPT: number;
        FILTER_REJECT: number;
      }
      (globalThis as unknown as { NodeFilter: MockNodeFilter }).NodeFilter = {
        SHOW_TEXT: 4,
        FILTER_ACCEPT: 1,
        FILTER_REJECT: 2,
      };
    });

    it('converts a plain vault file path in inline code to a clickable wikilink', () => {
      const app = createMockAppWithVaultFiles(['project/Emap2ligand.md']);
      const container = createContainer('<p>See <code>project/Emap2ligand.md</code> for details.</p>');

      processFileLinks(app, container as unknown as HTMLElement);

      const link = container.querySelectorAll('a')[0];
      expect(link).toBeDefined();
      expect(link.textContent).toBe('Emap2ligand');
      expect(link.getAttribute('data-href')).toBe('project/Emap2ligand.md');
      expect(link.className).toContain('internal-link');
      expect(link.className).toContain('pivi-file-link');
    });

    it('leaves non-existing paths as inline code', () => {
      const app = createMockAppWithVaultFiles([]);
      const container = createContainer('<p>See <code>project/Missing.md</code> for details.</p>');

      processFileLinks(app, container as unknown as HTMLElement);

      const codes = container.querySelectorAll('code');
      expect(codes.length).toBe(1);
      expect(codes[0].textContent).toBe('project/Missing.md');
      expect(container.querySelectorAll('a').length).toBe(0);
    });

    it('does not convert directory paths ending with slash', () => {
      const app = createMockAppWithVaultFiles([]);
      const container = createContainer('<p>See <code>inbox/article/</code> for details.</p>');

      processFileLinks(app, container as unknown as HTMLElement);

      const codes = container.querySelectorAll('code');
      expect(codes.length).toBe(1);
      expect(codes[0].textContent).toBe('inbox/article/');
      expect(container.querySelectorAll('a').length).toBe(0);
    });

    it('leaves generic inline code that does not look like a vault path', () => {
      const app = createMockAppWithVaultFiles(['project/MyFile.md']);
      const container = createContainer('<p>Use <code>npm install</code> and <code>foo bar</code>.</p>');

      processFileLinks(app, container as unknown as HTMLElement);

      const codes = container.querySelectorAll('code');
      expect(codes.length).toBe(2);
      expect(container.querySelectorAll('a').length).toBe(0);
    });
  });
});
