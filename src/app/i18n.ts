import { createI18n } from '@pivi/pivi-react';

export const appI18n = createI18n();

export const t = appI18n.t;
export const setLocale = appI18n.setLocale;
export const getLocale = appI18n.getLocale;

export type {
  Locale,
  TFunction,
  TranslationKey,
} from '@pivi/pivi-react';
