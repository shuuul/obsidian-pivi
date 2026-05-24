import {
  extractBoolean,
  extractString,
  extractStringArray,
  isRecord,
  normalizeStringArray,
  parseFrontmatter,
  validateSlugName,
} from '../../../src/utils/frontmatter';

describe('frontmatter utils', () => {
  describe('parseFrontmatter', () => {
    it('parses valid YAML frontmatter and body', () => {
      const content = `---
title: Hello
tags: [a, b]
---
Body text`;

      const parsed = parseFrontmatter(content);

      expect(parsed?.frontmatter.title).toBe('Hello');
      expect(parsed?.body).toBe('Body text');
    });

    it('returns null when frontmatter fence is missing', () => {
      expect(parseFrontmatter('# No frontmatter')).toBeNull();
    });

    it('uses fallback parser for malformed YAML with colons in values', () => {
      const content = `---
note: unquoted: value
---
body`;

      const parsed = parseFrontmatter(content);

      expect(parsed?.frontmatter.note).toBe('unquoted: value');
    });
  });

  describe('extractString', () => {
    it('returns non-empty strings', () => {
      expect(extractString({ name: 'Ada' }, 'name')).toBe('Ada');
    });

    it('formats string arrays as bracketed tokens', () => {
      expect(extractString({ tags: ['a', 'b'] }, 'tags')).toBe('[a] [b]');
    });

    it('returns undefined for missing or empty values', () => {
      expect(extractString({}, 'missing')).toBeUndefined();
      expect(extractString({ empty: '' }, 'empty')).toBeUndefined();
    });
  });

  describe('normalizeStringArray / extractStringArray', () => {
    it('splits comma-separated strings', () => {
      expect(normalizeStringArray('a, b ,c')).toEqual(['a', 'b', 'c']);
    });

    it('trims array elements via extractStringArray', () => {
      expect(extractStringArray({ items: [' x ', 'y'] }, 'items')).toEqual(['x', 'y']);
    });
  });

  describe('extractBoolean', () => {
    it('returns boolean values only', () => {
      expect(extractBoolean({ flag: true }, 'flag')).toBe(true);
      expect(extractBoolean({ flag: 'true' }, 'flag')).toBeUndefined();
    });
  });

  describe('isRecord', () => {
    it('narrows plain objects', () => {
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord([])).toBe(false);
    });
  });

  describe('validateSlugName', () => {
    it('accepts valid slugs', () => {
      expect(validateSlugName('my-agent', 'Agent')).toBeNull();
    });

    it('rejects empty, invalid characters, and YAML reserved words', () => {
      expect(validateSlugName('', 'Agent')).toMatch(/required/);
      expect(validateSlugName('Bad_Name', 'Agent')).toMatch(/lowercase/);
      expect(validateSlugName('true', 'Agent')).toMatch(/reserved/);
    });
  });
});
