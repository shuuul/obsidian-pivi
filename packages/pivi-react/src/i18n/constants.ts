/**
 * i18n Constants and Utilities
 *
 * Centralized constants for language management and UI display
 */

import type { Locale } from './types';

/**
 * Supported locales with metadata
 */
export interface LocaleInfo {
  code: Locale;
  name: string;           // Native name
  flag?: string;          // Optional flag emoji
}

/**
 * All supported locales with display information
 */
export const SUPPORTED_LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English',flag: '🇺🇸' },
  { code: 'zh-CN', name: '简体中文',flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文',flag: '🇹🇼' },
  { code: 'ja', name: '日本語',flag: '🇯🇵' },
  { code: 'ko', name: '한국어',flag: '🇰🇷' },
  { code: 'de', name: 'Deutsch',flag: '🇩🇪' },
  { code: 'fr', name: 'Français',flag: '🇫🇷' },
  { code: 'es', name: 'Español',flag: '🇪🇸' },
  { code: 'ru', name: 'Русский',flag: '🇷🇺' },
  { code: 'pt', name: 'Português',flag: '🇧🇷' },
];

/**
 * Default locale
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Get locale info by code
 */
export function getLocaleInfo(code: Locale): LocaleInfo | undefined {
  return SUPPORTED_LOCALES.find(locale => locale.code === code);
}

