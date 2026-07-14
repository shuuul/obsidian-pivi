import { getOrderedListEnterEdit } from '@/ui/chat/composer/markdownListContinuation';

function apply(text: string, cursor = text.length): { text: string; cursor: number } | null {
  const edit = getOrderedListEnterEdit(text, cursor);
  if (!edit) return null;
  return {
    text: text.slice(0, edit.start) + edit.replacement + text.slice(edit.end),
    cursor: edit.cursor,
  };
}

describe('ordered Markdown list continuation', () => {
  it.each([
    ['1. first', '1. first\n2. '],
    ['9. ninth', '9. ninth\n10. '],
    ['  2) nested', '  2) nested\n  3) '],
  ])('continues %s with the next marker', (source, expected) => {
    expect(apply(source)).toEqual({ text: expected, cursor: expected.length });
  });

  it('splits an item at the cursor', () => {
    const source = '1. first item';
    const cursor = '1. first'.length;
    const expected = '1. first\n2.  item';
    expect(apply(source, cursor)).toEqual({ text: expected, cursor: '1. first\n2. '.length });
  });

  it('removes an empty marker to exit the list', () => {
    const source = '1. first\n2. ';
    expect(apply(source)).toEqual({ text: '1. first\n', cursor: '1. first\n'.length });
  });

  it('leaves non-list input unchanged', () => {
    expect(apply('plain text')).toBeNull();
  });
});
