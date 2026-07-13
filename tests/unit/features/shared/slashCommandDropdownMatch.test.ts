import {
  appendHighlightedText,
  getItemMatchScore,
  getTextMatchScore,
} from '@/ui/shared/components/slashCommandDropdownMatch';
import type { DropdownItem } from '@/ui/shared/components/slashCommandDropdownData';

class FakeElement {
  readonly children: FakeElement[] = [];

  constructor(
    readonly text = '',
    readonly cls?: string,
  ) {}

  createSpan(options: { cls?: string; text?: string } = {}): FakeElement {
    const child = new FakeElement(options.text ?? '', options.cls);
    this.children.push(child);
    return child;
  }
}

function item(overrides: Partial<DropdownItem> = {}): DropdownItem {
  return {
    kind: 'skill',
    identity: '/obsidian-markdown',
    displayName: 'obsidian-markdown',
    insertValue: 'obsidian-markdown',
    description: 'Create structured notes',
    content: '',
    displayPrefix: '/',
    insertPrefix: '/',
    ...overrides,
  };
}

describe('slash command dropdown matching', () => {
  it('orders exact, prefix, boundary, contains, fuzzy, and missing matches', () => {
    expect(getTextMatchScore('open', 'open')).toBe(0);
    expect(getTextMatchScore('open-note', 'open')).toBe(15);
    expect(getTextMatchScore('vault-open', 'open')).toBe(46);
    expect(getTextMatchScore('reopen', 'open')).toBe(72);
    expect(getTextMatchScore('obsidian', 'osd')).toBe(124);
    expect(getTextMatchScore('vault', 'xyz')).toBe(Number.POSITIVE_INFINITY);
  });

  it('matches MCP server/tool names and falls back to descriptions', () => {
    expect(getItemMatchScore(item({
      kind: 'mcp',
      identity: '/exa/search',
      displayName: 'search',
      insertValue: 'exa/search',
      serverName: 'exa',
      toolName: 'search',
    }), 'exa/search')).toBe(0);
    expect(getItemMatchScore(item(), 'structured')).toBe(307);
  });

  it('highlights contiguous and fuzzy matches without changing text', () => {
    const contiguous = new FakeElement();
    appendHighlightedText(contiguous as unknown as HTMLElement, 'Open vault', 'vault');
    expect(contiguous.children.map((child) => [child.text, child.cls])).toEqual([
      ['Open ', undefined],
      ['vault', 'pivi-slash-match'],
    ]);

    const fuzzy = new FakeElement();
    appendHighlightedText(fuzzy as unknown as HTMLElement, 'Obsidian', 'osd');
    expect(fuzzy.children.map((child) => child.text).join('')).toBe('Obsidian');
    expect(fuzzy.children.filter((child) => child.cls === 'pivi-slash-match').map((child) => child.text)).toEqual([
      'O',
      's',
      'd',
    ]);
  });
});
