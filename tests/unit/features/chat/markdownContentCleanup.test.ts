import { } from '@/ui/chat/rendering/markdownContentCleanup';
import {
  isCurrentMarkdownRenderGeneration,
  nextMarkdownRenderGeneration,
} from '@/ui/chat/rendering/subagentRendererShared';

describe('markdownContentCleanup', () => {
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
