import { act, render, screen } from '@testing-library/react';

import {
  createI18n,
  I18nProvider,
  SUPPORTED_LOCALES,
  type TranslationKey,
  useT,
} from '@pivi/pivi-react';

import * as de from '../../packages/pivi-react/src/i18n/locales/de.json';
import * as en from '../../packages/pivi-react/src/i18n/locales/en.json';
import * as es from '../../packages/pivi-react/src/i18n/locales/es.json';
import * as fr from '../../packages/pivi-react/src/i18n/locales/fr.json';
import * as ja from '../../packages/pivi-react/src/i18n/locales/ja.json';
import * as ko from '../../packages/pivi-react/src/i18n/locales/ko.json';
import * as pt from '../../packages/pivi-react/src/i18n/locales/pt.json';
import * as ru from '../../packages/pivi-react/src/i18n/locales/ru.json';
import * as zhCN from '../../packages/pivi-react/src/i18n/locales/zh-CN.json';
import * as zhTW from '../../packages/pivi-react/src/i18n/locales/zh-TW.json';

type LocaleBundle = typeof en;

// TranslationKey is inferred from en.json; this assignment fails typecheck if they diverge.
const _translationKeyIsEnDotPath: TranslationKey = 'common.save';
void _translationKeyIsEnDotPath;

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

function collectLeafValues(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') {
    return new Map([[prefix.slice(0, -1), value]]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map();
  }

  return new Map(
    Object.entries(value).flatMap(([key, nestedValue]) => [
      ...collectLeafValues(nestedValue, `${prefix}${key}.`),
    ]),
  );
}

function collectPlaceholders(value: string): string[] {
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!).sort();
}

describe('i18n locale metadata', () => {
  it('uses SUPPORTED_LOCALES as the available locale source', () => {
    expect(createI18n().getAvailableLocales()).toEqual(SUPPORTED_LOCALES.map((locale) => locale.code));
  });

  it('derives display names from SUPPORTED_LOCALES metadata', () => {
    const i18n = createI18n();
    for (const locale of SUPPORTED_LOCALES) {
      expect(i18n.getLocaleDisplayName(locale.code)).toBe(locale.name);
    }
  });
});

describe('i18n instances', () => {
  it('keeps locale state independent and preserves interpolation behavior', () => {
    const english = createI18n();
    const german = createI18n('de');

    expect(english.t('common.save')).toBe('Save');
    expect(german.t('common.save')).toBe('Speichern');

    expect(german.setLocale('en')).toBe(true);
    expect(english.getLocale()).toBe('en');
    expect(german.getLocale()).toBe('en');
    expect(german.setLocale('invalid' as never)).toBe(false);
    expect(german.getLocale()).toBe('en');
  });
});

function SaveLabel() {
  const t = useT();
  return <span>{t('common.save')}</span>;
}

describe('I18nProvider', () => {
  it('updates hook consumers when the shared translator locale changes', () => {
    const i18n = createI18n();
    render(
      <I18nProvider i18n={i18n}>
        <SaveLabel />
      </I18nProvider>,
    );

    expect(screen.getByText('Save')).toBeInTheDocument();
    act(() => {
      i18n.setLocale('de');
    });
    expect(screen.getByText('Speichern')).toBeInTheDocument();
  });

  it('requires an explicit provider', () => {
    expect(() => render(<SaveLabel />)).toThrow('useI18n must be used within an I18nProvider');
  });
});

describe('i18n locale key shapes', () => {
  it('keeps every locale aligned to en.json', () => {
    const enKeys = collectKeyPaths(en).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(collectKeyPaths(localeBundles[locale.code]).sort()).toEqual(enKeys);
    }
  });

  it('keeps interpolation placeholders aligned to en.json', () => {
    const englishValues = collectLeafValues(en);

    for (const locale of SUPPORTED_LOCALES) {
      const localeValues = collectLeafValues(localeBundles[locale.code]);
      for (const [key, englishValue] of englishValues) {
        expect({
          locale: locale.code,
          key,
          placeholders: collectPlaceholders(localeValues.get(key) ?? ''),
        }).toEqual({
          locale: locale.code,
          key,
          placeholders: collectPlaceholders(englishValue),
        });
      }
    }
  });
});
