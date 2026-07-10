import {
  getSubagentWriterBaseName,
  resolveSubagentWriterIconName,
  resolveSubagentWriterName,
  stableSubagentHash,
  SUBAGENT_PROFILES,
  SUBAGENT_WRITER_NAMES,
} from '@/ui/chat/subagentProfiles';

describe('subagent profiles', () => {
  it('keeps writer names unique and in the established assignment order', () => {
    expect(SUBAGENT_WRITER_NAMES).toEqual([
      'Austen',
      'Baldwin',
      'Borges',
      'Brontë',
      'Calvino',
      'Dostoevsky',
      'Eliot',
      'Homer',
      'Kafka',
      'Le Guin',
      'Morrison',
      'Murakami',
      'Neruda',
      'Sappho',
      'Tolstoy',
      'Woolf',
    ]);
    expect(new Set(SUBAGENT_WRITER_NAMES).size).toBe(SUBAGENT_PROFILES.length);
  });

  it('resolves stable fallback names from task ids', () => {
    const taskId = 'task-history-fallback';
    const expectedIndex = stableSubagentHash(taskId) % SUBAGENT_WRITER_NAMES.length;

    expect(stableSubagentHash(taskId)).toBe(2487097155);
    expect(resolveSubagentWriterName(taskId)).toBe(SUBAGENT_WRITER_NAMES[expectedIndex]);
    expect(resolveSubagentWriterName(taskId)).toBe('Brontë');
  });

  it('resolves profile icons for base and numbered writer names', () => {
    expect(getSubagentWriterBaseName('Baldwin 2')).toBe('Baldwin');
    expect(getSubagentWriterBaseName('Le Guin 12')).toBe('Le Guin');
    expect(resolveSubagentWriterIconName('Baldwin 2')).toBe('flame');
    expect(resolveSubagentWriterIconName('Le Guin 12')).toBe('satellite-dish');
    expect(resolveSubagentWriterIconName('Unknown')).toBeUndefined();
    expect(resolveSubagentWriterIconName()).toBeUndefined();
  });
});
