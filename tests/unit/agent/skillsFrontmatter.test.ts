import {
  extractBoolean,
  extractString,
  extractStringArray,
  isRecord,
  normalizeStringArray,
  parseFrontmatter,
  validateSlugName,
} from '@pivi/agent/skills/frontmatter';

describe('Skills frontmatter', () => {
  it('parses scalar, array, boolean, and body values without a host YAML dependency', () => {
    const parsed = parseFrontmatter(`---
name: my-skill
tags: [a, b]
enabled: true
---
Body text`);

    expect(parsed).toEqual({
      frontmatter: { name: 'my-skill', tags: ['a', 'b'], enabled: true },
      body: 'Body text',
    });
  });

  it('returns null when frontmatter fences are missing', () => {
    expect(parseFrontmatter('# No frontmatter')).toBeNull();
  });

  it('retains unquoted values containing colons', () => {
    expect(parseFrontmatter('---\nnote: unquoted: value\n---\nbody')?.frontmatter.note)
      .toBe('unquoted: value');
  });

  it('extracts supported string, string-array, and boolean values', () => {
    expect(extractString({ name: 'Ada' }, 'name')).toBe('Ada');
    expect(extractString({ tags: ['a', 'b'] }, 'tags')).toBe('[a] [b]');
    expect(normalizeStringArray('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(extractStringArray({ items: [' x ', 'y'] }, 'items')).toEqual(['x', 'y']);
    expect(extractBoolean({ flag: true }, 'flag')).toBe(true);
    expect(extractBoolean({ flag: 'true' }, 'flag')).toBeUndefined();
  });

  it('recognizes records and validates skill slugs', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(validateSlugName('my-skill', 'Skill')).toBeNull();
    expect(validateSlugName('', 'Skill')).toMatch(/required/);
    expect(validateSlugName('Bad_Name', 'Skill')).toMatch(/lowercase/);
    expect(validateSlugName('true', 'Skill')).toMatch(/reserved/);
  });
});
