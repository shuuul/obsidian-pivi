import { findLastVisibleConversationEntryId } from '@pivi/pivi-agent-core/engine/pi/session/visibleSessionEntries';

type TestEntry = Parameters<typeof findLastVisibleConversationEntryId>[0][number];

function message(id: string, role: string): TestEntry {
  return {
    id,
    type: 'message',
    parentId: null,
    message: { role },
  } as TestEntry;
}

function custom(id: string): TestEntry {
  return {
    id,
    type: 'custom',
    parentId: null,
  } as TestEntry;
}

describe('findLastVisibleConversationEntryId', () => {
  it('returns the last user or assistant message by default', () => {
    expect(findLastVisibleConversationEntryId([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('tool1', 'toolResult'),
      custom('meta1'),
    ])).toBe('a1');
  });
  it('returns the trailing user message when it is the last visible conversation entry', () => {
    expect(findLastVisibleConversationEntryId([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
    ])).toBe('u2');
  });


  it('returns the last entry matching the requested visible role', () => {
    const entries = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('u2', 'user'),
      message('a2', 'assistant'),
    ];

    expect(findLastVisibleConversationEntryId(entries, 'user')).toBe('u2');
    expect(findLastVisibleConversationEntryId(entries, 'assistant')).toBe('a2');
  });

  it('returns null when no visible conversation message matches', () => {
    expect(findLastVisibleConversationEntryId([])).toBeNull();
    expect(findLastVisibleConversationEntryId([custom('meta'), message('tool', 'toolResult')])).toBeNull();
    expect(findLastVisibleConversationEntryId([message('u1', 'user')], 'assistant')).toBeNull();
  });
});
