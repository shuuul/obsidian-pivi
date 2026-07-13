/**
 * i18n - Internationalization service for Pivi
 *
 * Provides translation functionality for all UI strings.
 * Supports 10 locales with English as the default fallback.
 */

import { DEFAULT_LOCALE, getLocaleInfo, SUPPORTED_LOCALES } from './constants';
import * as de from './locales/de.json';
import * as en from './locales/en.json';
import * as es from './locales/es.json';
import * as fr from './locales/fr.json';
import * as ja from './locales/ja.json';
import * as ko from './locales/ko.json';
import * as pt from './locales/pt.json';
import * as ru from './locales/ru.json';
import * as zhCN from './locales/zh-CN.json';
import * as zhTW from './locales/zh-TW.json';
import type { I18n, Locale, TFunction, TranslationKey, TranslationParams } from './types';

const translations: Record<Locale, typeof en> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  ru,
  pt,
};

function translateFrom(
  dict: typeof en,
  key: TranslationKey,
  params?: TranslationParams,
): string | undefined {
  const keys = key.split('.');
  let value: unknown = dict;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  if (params) {
    return value.replace(/\{(\w+)\}/g, (match: string, param: string): string => {
      const replacement = params[param];
      return replacement !== undefined ? `${replacement}` : match;
    });
  }

  return value;
}

export function createI18n(initialLocale: Locale = DEFAULT_LOCALE): I18n {
  let currentLocale = translations[initialLocale] ? initialLocale : DEFAULT_LOCALE;
  const listeners = new Set<() => void>();

  const t: TFunction = (key, params) => {
    return translateFrom(translations[currentLocale], key, params)
      ?? translateFrom(translations[DEFAULT_LOCALE], key, params)
      ?? key;
  };

  return {
    t,
    setLocale(locale): boolean {
      if (!translations[locale]) {
        return false;
      }
      if (currentLocale !== locale) {
        currentLocale = locale;
        listeners.forEach((listener) => listener());
      }
      return true;
    },
    getLocale: () => currentLocale,
    getAvailableLocales: () => SUPPORTED_LOCALES.map((locale) => locale.code),
    getLocaleDisplayName: (locale) => getLocaleInfo(locale)?.name ?? locale,
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
