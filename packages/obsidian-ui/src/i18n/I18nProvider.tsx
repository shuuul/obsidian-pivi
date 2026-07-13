import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react';

import type { I18n, TFunction } from './types';

const I18nContext = createContext<I18n | null>(null);

export interface I18nProviderProps {
  readonly i18n: I18n;
  readonly children: ReactNode;
}

export function I18nProvider({ i18n, children }: I18nProviderProps) {
  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return i18n;
}

export function useT(): TFunction {
  const i18n = useI18n();
  useSyncExternalStore(i18n.subscribe, i18n.getLocale, i18n.getLocale);
  return i18n.t;
}
