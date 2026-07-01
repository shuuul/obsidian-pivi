import type { App, Component, WorkspaceLeaf } from 'obsidian';

import {
  extractLinkTarget,
  normalizeObsidianAppLinksInMarkdown,
  registerFileLinkHandler,
} from '../../../src/utils/fileLink';
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
});
