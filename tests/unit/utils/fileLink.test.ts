import type { App, Component } from 'obsidian';

import { extractLinkTarget, registerFileLinkHandler } from '../../../src/utils/fileLink';
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
  });
});
