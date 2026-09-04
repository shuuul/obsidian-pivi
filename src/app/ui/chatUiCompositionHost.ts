import type { ChatFacade, SessionsFacade } from '@/app/hostContracts';

/** Composition-only plugin capabilities adapted into core-owned chat ports. */
export type ChatUiCompositionHost = ChatFacade;
export type ChatUiSessionHost = SessionsFacade;
