import { stripLeadingWhitespaceForNewTextBlock } from '@/ui/chat/rendering/markdownContentCleanup';

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
});
