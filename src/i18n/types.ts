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
