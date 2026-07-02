import { SUPPORTED_LOCALES } from '@/i18n';
import { getAvailableLocales, getLocaleDisplayName } from '@/i18n';
import type { TranslationKey } from '@/i18n';

import * as de from '@/i18n/locales/de.json';
import * as en from '@/i18n/locales/en.json';
import * as es from '@/i18n/locales/es.json';
import * as fr from '@/i18n/locales/fr.json';
import * as ja from '@/i18n/locales/ja.json';
import * as ko from '@/i18n/locales/ko.json';
import * as pt from '@/i18n/locales/pt.json';
import * as ru from '@/i18n/locales/ru.json';
import * as zhCN from '@/i18n/locales/zh-CN.json';
import * as zhTW from '@/i18n/locales/zh-TW.json';

type LocaleBundle = typeof en;
type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPaths<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

type EnTranslationKey = DotPaths<LocaleBundle>;

const enDotPathsMatchTranslationKey = {} as Record<EnTranslationKey, true> satisfies Record<TranslationKey, true>;
void enDotPathsMatchTranslationKey;

const localeBundles: Record<string, LocaleBundle> = {
  en,
  de,
  es,
  fr,
  ja,
  ko,
  pt,
  ru,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

function collectKeyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix.slice(0, -1)];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => collectKeyPaths(nestedValue, `${prefix}${key}.`));
}

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

describe('i18n locale key shapes', () => {
  it('keeps every locale aligned to en.json', () => {
    const enKeys = collectKeyPaths(en).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(collectKeyPaths(localeBundles[locale.code]).sort()).toEqual(enKeys);
    }
  });
});
