import { createContext, type ReactNode, useContext } from 'react';

import type { BeginDisclosureResize } from './types';

const NOOP_BEGIN_DISCLOSURE_RESIZE: BeginDisclosureResize = () => {};
const DisclosureAnchorContext = createContext<BeginDisclosureResize>(NOOP_BEGIN_DISCLOSURE_RESIZE);

export function DisclosureAnchorProvider({
  beginDisclosureResize,
  children,
}: {
  readonly beginDisclosureResize: BeginDisclosureResize;
  readonly children: ReactNode;
}) {
  return (
    <DisclosureAnchorContext.Provider value={beginDisclosureResize}>
      {children}
    </DisclosureAnchorContext.Provider>
  );
}

export function useBeginDisclosureResize(): BeginDisclosureResize {
  return useContext(DisclosureAnchorContext);
}
