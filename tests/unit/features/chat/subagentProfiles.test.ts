import {
  getSubagentWriterBaseName,
  resolveSubagentWriterIconName,
  resolveSubagentWriterName,
  stableSubagentHash,
  SUBAGENT_PROFILES,
  SUBAGENT_WRITER_NAMES,
} from '@/ui/chat/subagentProfiles';

describe('subagent profiles', () => {
  it('keeps writer names unique and stable in catalog order', () => {
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
      'Rand',
      'Mishima',
      'Pamuk',
    ]);
    expect(new Set(SUBAGENT_WRITER_NAMES).size).toBe(SUBAGENT_PROFILES.length);
  });

  it('provides reusable identity metadata for every writer', () => {
    for (const profile of SUBAGENT_PROFILES) {
      expect(profile.fullName).not.toBe('');
    }

    expect(SUBAGENT_PROFILES.find(profile => profile.name === 'Rand')?.fullName).toBe('Ayn Rand');
    expect(SUBAGENT_PROFILES.find(profile => profile.name === 'Mishima')?.fullName).toBe('Mishima Yukio');
    expect(SUBAGENT_PROFILES.find(profile => profile.name === 'Pamuk')?.fullName).toBe('Ferit Orhan Pamuk');
  });

  it('resolves stable fallback names from task ids', () => {
    const taskId = 'task-history-fallback';

    expect(stableSubagentHash(taskId)).toBe(2487097155);
    expect(resolveSubagentWriterName(taskId)).toBe('Brontë');
  });

  it('resolves profile icons for base and numbered writer names', () => {
    expect(getSubagentWriterBaseName('Baldwin 2')).toBe('Baldwin');
    expect(getSubagentWriterBaseName('Le Guin 12')).toBe('Le Guin');
    expect(resolveSubagentWriterIconName('Baldwin 2')).toBe('flame');
    expect(resolveSubagentWriterIconName('Le Guin 12')).toBe('satellite-dish');
    expect(resolveSubagentWriterIconName('Calvino')).toBe('tree');
    expect(resolveSubagentWriterIconName('Rand')).toBe('scale');
    expect(resolveSubagentWriterIconName('Mishima')).toBe('flower-2');
    expect(resolveSubagentWriterIconName('Pamuk')).toBe('snowflake');
    expect(resolveSubagentWriterIconName('Unknown')).toBeUndefined();
    expect(resolveSubagentWriterIconName()).toBeUndefined();
  });
});
