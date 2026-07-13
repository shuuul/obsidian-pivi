import { act, render, screen } from '@testing-library/react';

import {
  createI18n,
  I18nProvider,
  SUPPORTED_LOCALES,
  type TranslationKey,
  useT,
} from '@pivi/obsidian-ui';

import * as de from '../../packages/obsidian-ui/src/i18n/locales/de.json';
import * as en from '../../packages/obsidian-ui/src/i18n/locales/en.json';
import * as es from '../../packages/obsidian-ui/src/i18n/locales/es.json';
import * as fr from '../../packages/obsidian-ui/src/i18n/locales/fr.json';
import * as ja from '../../packages/obsidian-ui/src/i18n/locales/ja.json';
import * as ko from '../../packages/obsidian-ui/src/i18n/locales/ko.json';
import * as pt from '../../packages/obsidian-ui/src/i18n/locales/pt.json';
import * as ru from '../../packages/obsidian-ui/src/i18n/locales/ru.json';
import * as zhCN from '../../packages/obsidian-ui/src/i18n/locales/zh-CN.json';
import * as zhTW from '../../packages/obsidian-ui/src/i18n/locales/zh-TW.json';

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
    expect(english.t('common.errorWithMessage', { message: 'boom' })).toBe('Error: boom');
    expect(english.t('common.errorWithMessage')).toBe('Error: {message}');

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
});
