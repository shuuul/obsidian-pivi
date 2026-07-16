import { act } from '@testing-library/react';

import { createI18n } from '@pivi/pivi-react';
import {
  mountChatView,
  mountSettings,
  type SurfaceEnvironment,
} from '@pivi/pivi-react/mount';
import type { SettingsPorts } from '@pivi/pivi-react/ports';
import { ChatTabsStore, type ChatTabActions } from '@pivi/pivi-react/store';

import { testPresentationPlatform } from '../helpers/presentationPlatform';

function createChatShell(position: 'input' | 'header' = 'header') {
  const actions: ChatTabActions = {
    archiveTab: jest.fn(),
    closeTab: jest.fn(),
    renameTab: jest.fn(),
    startNewChat: jest.fn(),
    switchTab: jest.fn(),
  };
  const inputPortalContainer = document.createElement('div');
  return {
    actions,
    inputPortalContainer,
    store: new ChatTabsStore({
      chatIcon: { kind: 'pivi-brand', viewBox: '0 0 100 100' },
      items: [],
      position,
    }),
  };
}

describe('React surface mounts', () => {
  it('gives the imperative chat adapter one isolated container and disposes once', async () => {
    const hostContainer = document.createElement('div');
    document.body.appendChild(hostContainer);
    const dispose = jest.fn();
    const receivedEnvironments: SurfaceEnvironment[] = [];
    let mounted: Awaited<ReturnType<typeof mountChatView>>;

    await act(async () => {
      mounted = await mountChatView({
        container: hostContainer,
        ownerDocument: document,
        ownerWindow: window,
        portalContainer: document.body,
        i18n: createI18n(),
        platform: testPresentationPlatform,
        chatShell: createChatShell(),
        imperativeAdapter: {
          mount(container, environment) {
            receivedEnvironments.push(environment);
            const adapterChild = environment.ownerDocument.createElement('span');
            adapterChild.dataset.adapterOwned = 'true';
            container.appendChild(adapterChild);
          },
          dispose,
        },
      });
    });

    const reactContainer = hostContainer.querySelector('[data-pivi-react-surface="chat"]');
    expect(hostContainer.childElementCount).toBe(1);
    expect(reactContainer?.querySelector('[data-adapter-owned="true"]')).not.toBeNull();
    expect(receivedEnvironments[0]?.ownerDocument).toBe(document);
    expect(receivedEnvironments[0]?.ownerWindow).toBe(window);
    expect(receivedEnvironments[0]?.portalContainer).toBe(document.body);
    expect(receivedEnvironments[0]).toEqual({
      ownerDocument: document,
      ownerWindow: window,
      portalContainer: document.body,
    });

    await act(async () => {
      await mounted.dispose();
      await mounted.dispose();
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(hostContainer).toBeEmptyDOMElement();
  });

  it('disposes a partially mounted imperative chat adapter when mounting fails', async () => {
    const hostContainer = document.createElement('div');
    document.body.appendChild(hostContainer);
    const mountError = new Error('restore failed');
    const dispose = jest.fn();

    await expect(act(async () => {
      await mountChatView({
        container: hostContainer,
        ownerDocument: document,
        ownerWindow: window,
        portalContainer: document.body,
        i18n: createI18n(),
        platform: testPresentationPlatform,
        chatShell: createChatShell(),
        imperativeAdapter: {
          mount(container) {
            container.appendChild(document.createElement('span'));
            throw mountError;
          },
          dispose,
        },
      });
    })).rejects.toBe(mountError);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(hostContainer).toBeEmptyDOMElement();
  });

  it('mounts settings with the supplied owner realm', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument;
    const ownerWindow = iframe.contentWindow;
    expect(ownerDocument).not.toBeNull();
    expect(ownerWindow).not.toBeNull();
    if (!ownerDocument || !ownerWindow) return;

    const hostContainer = ownerDocument.createElement('div');
    ownerDocument.body.appendChild(hostContainer);
    let mounted: Awaited<ReturnType<typeof mountSettings>>;

    await act(async () => {
      mounted = await mountSettings({
        container: hostContainer,
        ownerDocument,
        ownerWindow,
        portalContainer: ownerDocument.body,
        i18n: createI18n(),
        platform: testPresentationPlatform,
        ports: {
          snapshot: {
            getSnapshot: () => ({
              general: {
                locale: 'en',
                chatViewPlacement: 'right-sidebar',
                tabBarPosition: 'input',
                enableAutoScroll: true,
                deferMathRenderingDuringStreaming: true,
                enableAutoTitleGeneration: false,
                autoCompact: true,
                autoCompactThresholdPercent: 90,
                autoCompactKeepRecentTokens: 20_000,
                userName: '',
                excludedTags: [],
                requireCommandOrControlEnterToSend: false,
                keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
              },
              subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2, showActiveWorkShelf: false },
            }),
          },
          actions: {},
          environment: {
            getActiveEnvironmentVariables: () => '',
            getEnvironmentVariables: () => '',
            applyEnvironmentVariables: async () => undefined,
            applyEnvironmentVariablesBatch: async () => undefined,
            getReviewKeys: () => [],
          },
          hotkeys: {
            listHotkeys: () => [],
            openHotkeySettings: () => undefined,
          },
          hostIntegrations: {
            listSections: () => [],
            runAction: async () => ({}),
          },
        } as unknown as SettingsPorts,
      });
    });

    expect(hostContainer.firstElementChild?.ownerDocument).toBe(ownerDocument);
    expect(hostContainer.querySelector('[data-pivi-react-surface="settings"]')).not.toBeNull();
    await act(async () => mounted.dispose());
  });
});
