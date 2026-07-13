import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import type { I18n } from '../i18n';
import { I18nProvider } from '../i18n';
import type { ChatPorts, SettingsPorts } from '../ports';
import { SettingsRoot } from '../settings';
import { ChatShell, type ChatShellOptions } from './ChatShell';

export interface SurfaceEnvironment {
  ownerDocument: Document;
  ownerWindow: Window;
  portalContainer: HTMLElement;
}

export interface ImperativeChatAdapter {
  mount(container: HTMLElement, environment: SurfaceEnvironment): Promise<void> | void;
  dispose(): Promise<void> | void;
}

export interface MountedSurface {
  dispose(): Promise<void>;
}

interface MountSurfaceOptions<TPorts> extends SurfaceEnvironment {
  container: HTMLElement;
  i18n: I18n;
  ports: TPorts;
}

export type MountChatViewOptions = MountSurfaceOptions<ChatPorts> & {
  chatShell: ChatShellOptions;
  imperativeAdapter: ImperativeChatAdapter;
};
export type MountSettingsOptions = MountSurfaceOptions<SettingsPorts>;

async function cleanupFailedChatMount(
  root: Root,
  imperativeAdapter: ImperativeChatAdapter,
  mountError: unknown,
): Promise<never> {
  try {
    await imperativeAdapter.dispose();
  } catch (cleanupError) {
    throw new AggregateError(
      [mountError, cleanupError],
      'Failed to mount and clean up the chat surface.',
    );
  } finally {
    root.unmount();
  }
  throw mountError;
}


export function mountChatView(options: MountChatViewOptions): Promise<MountedSurface> {
  return mountChatSurface(options);
}

async function mountChatSurface(options: MountChatViewOptions): Promise<MountedSurface> {
  let imperativeContainer: HTMLDivElement | null = null;
  const root: Root = createRoot(options.container);
  flushSync(() => {
    root.render(
      <I18nProvider i18n={options.i18n}>
        <ChatShell
          ownerWindow={options.ownerWindow}
          setImperativeContainer={(element) => {
            imperativeContainer = element;
          }}
          shell={options.chatShell}
        />
      </I18nProvider>,
    );
  });
  if (!imperativeContainer) {
    root.unmount();
    throw new Error('Failed to create the chat imperative adapter container.');
  }
  try {
    await options.imperativeAdapter.mount(imperativeContainer, options);
  } catch (error) {
    return cleanupFailedChatMount(root, options.imperativeAdapter, error);
  }
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await options.imperativeAdapter.dispose();
      } finally {
        root.unmount();
      }
    },
  };
}

export async function mountSettings(options: MountSettingsOptions): Promise<MountedSurface> {
  const root: Root = createRoot(options.container);
  flushSync(() => {
    root.render(
      <I18nProvider i18n={options.i18n}>
        <div className="pivi-react-settings-root" data-pivi-react-surface="settings">
          <SettingsRoot ports={options.ports} />
        </div>
      </I18nProvider>,
    );
  });
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      root.unmount();
    },
  };
}
