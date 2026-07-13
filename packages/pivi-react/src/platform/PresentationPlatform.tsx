import { createContext, type ReactNode, useContext } from 'react';

export interface PresentationTooltipOptions {
  readonly delay?: number;
}

export interface PresentationPlatform {
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
