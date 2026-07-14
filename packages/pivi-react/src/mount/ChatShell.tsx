import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { ChatLogo } from './ChatLogo';
import { ActiveTabSurfaces } from './surfaces';
import { ChatTabBar } from './tab-bar';
import type { ChatShellOptions } from './types';

export type { ChatShellOptions, ChatSurfaceActions, WelcomeQuoteAdapter } from './types';

export function ChatShell({
  ownerWindow,
  setImperativeContainer,
  shell,
}: {
  ownerWindow: Window;
  setImperativeContainer: (element: HTMLDivElement | null) => void;
  shell: ChatShellOptions;
}) {
  const snapshot = useSyncExternalStore(
    shell.store.subscribe,
    shell.store.getSnapshot,
    shell.store.getSnapshot,
  );
  const inputPortalContainer = shell.inputPortalContainer;
  const tabBar = <ChatTabBar ownerWindow={ownerWindow} shell={shell} />;

  return (
    <div
      className={`pivi-react-chat-root pivi-container${snapshot.position === 'header' ? ' pivi-container--header-mode' : ''}`}
      data-pivi-react-surface="chat"
    >
      <header className="pivi-header">
        <div className="pivi-title-slot">
          <span className="pivi-logo"><ChatLogo icon={snapshot.chatIcon} /></span>
          <h4 className="pivi-title-text">Pivi</h4>
        </div>
        {snapshot.position === 'header'
          ? <div className="pivi-tab-bar-container">{tabBar}</div>
          : null}
      </header>
      <div className="pivi-tab-content-container" ref={setImperativeContainer} />
      <ActiveTabSurfaces shell={shell} />
      {snapshot.position === 'input' && inputPortalContainer
        ? createPortal(
            <div className="pivi-input-nav-content">
              <div className="pivi-tab-bar-container">{tabBar}</div>
            </div>,
            inputPortalContainer,
          )
        : null}
    </div>
  );
}
