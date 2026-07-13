import { createContext, type ReactNode, useContext } from 'react';

import { type Locale,useI18n } from '../i18n';

export interface PresentationTooltipOptions {
  readonly delay?: number;
}

export interface HostTerminology {
  readonly hostName: string;
  readonly workspaceName: string;
  readonly secureStorageName: string;
}

export interface PresentationPlatform {
  getTerminology(locale: Locale): HostTerminology;
  renderIcon(container: HTMLElement, name: string): void;
  attachTooltip(
    container: HTMLElement,
    label: string,
    options?: PresentationTooltipOptions,
  ): void;
}

const PresentationPlatformContext = createContext<PresentationPlatform | null>(null);

export function PresentationPlatformProvider({
  children,
  platform,
}: {
  readonly children: ReactNode;
  readonly platform: PresentationPlatform;
}) {
  return (
    <PresentationPlatformContext.Provider value={platform}>
      {children}
    </PresentationPlatformContext.Provider>
  );
}

export function usePresentationPlatform(): PresentationPlatform {
  const platform = useContext(PresentationPlatformContext);
  if (!platform) {
    throw new Error(
      'usePresentationPlatform must be used within a PresentationPlatformProvider',
    );
  }
  return platform;
}

export function useHostTerminology(): HostTerminology {
  const i18n = useI18n();
  return usePresentationPlatform().getTerminology(i18n.getLocale());
}
