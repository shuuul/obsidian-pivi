import { SUPPORTED_LOCALES } from '../../../src/i18n/constants';
import { getAvailableLocales, getLocaleDisplayName } from '../../../src/i18n/i18n';

describe('i18n locale metadata', () => {
  it('uses SUPPORTED_LOCALES as the available locale source', () => {
    expect(getAvailableLocales()).toEqual(SUPPORTED_LOCALES.map((locale) => locale.code));
  });

  it('derives display names from SUPPORTED_LOCALES metadata', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getLocaleDisplayName(locale.code)).toBe(locale.name);
    }
  });
});
