import { createI18n } from '@pivi/pivi-react';

export const appI18n = createI18n();

export const t = appI18n.t;
export const setLocale = appI18n.setLocale;
export const getLocale = appI18n.getLocale;

export type {
  I18n,
  Locale,
  LocaleInfo,
  TFunction,
  TranslationKey,
  TranslationParams,
} from '@pivi/pivi-react';
export {
  DEFAULT_LOCALE,
  getLocaleInfo,
  SUPPORTED_LOCALES,
} from '@pivi/pivi-react';
