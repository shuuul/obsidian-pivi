import { getItemViewContainerEl } from '@/ui/shared/utils/obsidianPrivateApi';

describe('obsidianPrivateApi', () => {
  it('returns undefined when there is no active ItemView', () => {
    expect(getItemViewContainerEl(undefined)).toBeUndefined();
  });

  it('returns the view container when present', () => {
    const containerEl = {} as HTMLElement;
    expect(getItemViewContainerEl({ containerEl } as never)).toBe(containerEl);
  });
});
