import { stripLeadingWhitespaceForNewTextBlock } from '@/ui/chat/rendering/markdownContentCleanup';
import {
  isCurrentMarkdownRenderGeneration,
  nextMarkdownRenderGeneration,
} from '@/ui/chat/rendering/subagentRendererShared';

describe('markdownContentCleanup', () => {
  describe('stripLeadingWhitespaceForNewTextBlock', () => {
    it('removes leading newlines and spaces', () => {
      expect(stripLeadingWhitespaceForNewTextBlock('\n\nNow I will edit')).toBe('Now I will edit');
      expect(stripLeadingWhitespaceForNewTextBlock('  \t hello')).toBe('hello');
    });

    it('returns empty string when input is only whitespace', () => {
      expect(stripLeadingWhitespaceForNewTextBlock('\n\n  ')).toBe('');
    });
  });

  describe('Markdown render generation', () => {
    it('invalidates an older asynchronous render when a newer render starts', () => {
      const el = { dataset: {} } as HTMLElement;

      const staleGeneration = nextMarkdownRenderGeneration(el);
      const currentGeneration = nextMarkdownRenderGeneration(el);

      expect(staleGeneration).toBe('1');
      expect(currentGeneration).toBe('2');
      expect(isCurrentMarkdownRenderGeneration(el, staleGeneration)).toBe(false);
      expect(isCurrentMarkdownRenderGeneration(el, currentGeneration)).toBe(true);
    });
  });
});
