import type en from './locales/en.json';

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr' | 'es' | 'ru' | 'pt';

/**
 * Dot-path keys derived from the canonical English locale catalog.
 * Add keys in en.json first; other locales must mirror the same tree.
 */
type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPaths<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPaths<typeof en>;

export type TranslationParams = Readonly<Record<string, string | number>>;

export type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

export interface I18n {
  readonly t: TFunction;
  readonly setLocale: (locale: Locale) => boolean;
  readonly getLocale: () => Locale;
  readonly getAvailableLocales: () => Locale[];
  readonly getLocaleDisplayName: (locale: Locale) => string;
  readonly subscribe: (listener: () => void) => () => void;
}
