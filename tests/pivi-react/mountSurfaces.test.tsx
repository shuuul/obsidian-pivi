import { act, fireEvent } from '@testing-library/react';

import { createI18n } from '@pivi/pivi-react';
import {
  mountChatView,
  mountInlineEditSurfaceChrome,
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
    reorderTabs: jest.fn(async () => true),
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
                userName: '',
                excludedTags: [],
                requireCommandOrControlEnterToSend: false,
                keyboardNavigation: { scrollUpKey: 'w', scrollDownKey: 's', focusInputKey: 'i' },
                editorSelectionToolbar: { enabled: true, shortcuts: [] },
              },
              subagents: { enabled: true, allowBackground: false, maxConcurrentSubagents: 2 },
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
          editorToolbar: {
            listHostCommands: () => [],
            listPiviCommands: async () => [],
            listIconNames: () => [],
            isNoteToolbarTextToolbarActive: () => false,
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

  it('portals inline edit selectors into the owner realm above editor layers', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const ownerDocument = iframe.contentDocument;
    expect(ownerDocument).not.toBeNull();
    if (!ownerDocument) return;

    const container = ownerDocument.createElement('div');
    ownerDocument.body.appendChild(container);
    let mounted: ReturnType<typeof mountInlineEditSurfaceChrome>;
    await act(async () => {
      mounted = mountInlineEditSurfaceChrome({
        container,
        i18n: createI18n(),
        platform: testPresentationPlatform,
        props: {
          adaptiveReasoning: true,
          defaultReasoningValue: 'off',
          model: 'model-a',
          modelOptions: [
            { label: 'Model A', value: 'model-a' },
            { label: 'Model B', value: 'model-b' },
          ],
          onModelChange: jest.fn(),
          onThinkingChange: jest.fn(),
          thinkingLevel: 'high',
          thinkingOptions: [
            { label: 'Off', value: 'off' },
            { label: 'High', value: 'high' },
          ],
        },
      });
    });

    const modelButton = container.querySelector<HTMLButtonElement>('.pivi-model-btn');
    expect(modelButton).not.toBeNull();
    Object.defineProperty(modelButton, 'getBoundingClientRect', {
      value: () => ({ bottom: 44, height: 24, left: 20, right: 120, top: 20, width: 100, x: 20, y: 20, toJSON: () => ({}) }),
    });
    await act(async () => modelButton?.click());

    const modelDropdown = ownerDocument.body.querySelector<HTMLElement>('.pivi-model-dropdown.pivi-inline-selector-dropdown-fixed');
    expect(modelDropdown).not.toBeNull();
    expect(container.contains(modelDropdown)).toBe(false);
    expect(modelDropdown?.style.top).toBe('48px');
    expect(document.body.contains(modelDropdown)).toBe(false);

    await act(async () => modelButton?.click());
    expect(ownerDocument.querySelector('.pivi-model-dropdown.pivi-inline-selector-dropdown-fixed')).toBeNull();

    const modelSelector = container.querySelector<HTMLElement>('.pivi-model-selector');
    fireEvent.mouseEnter(modelSelector!);
    expect(ownerDocument.querySelector('.pivi-model-dropdown.pivi-inline-selector-dropdown-fixed')).not.toBeNull();
    fireEvent.mouseLeave(modelSelector!, { relatedTarget: ownerDocument.body });
    await act(async () => new Promise(resolve => ownerDocument.defaultView?.setTimeout(resolve, 100)));
    expect(ownerDocument.querySelector('.pivi-model-dropdown.pivi-inline-selector-dropdown-fixed')).toBeNull();

    fireEvent.mouseEnter(modelSelector!);
    await act(async () => modelButton?.click());
    fireEvent.mouseLeave(modelSelector!, { relatedTarget: ownerDocument.body });
    await act(async () => new Promise(resolve => ownerDocument.defaultView?.setTimeout(resolve, 100)));
    expect(ownerDocument.querySelector('.pivi-model-dropdown.pivi-inline-selector-dropdown-fixed')).not.toBeNull();
    await act(async () => modelButton?.click());

    const thinkingButton = container.querySelector<HTMLButtonElement>('.pivi-thinking-current');
    expect(thinkingButton).not.toBeNull();
    await act(async () => thinkingButton?.click());
    expect(ownerDocument.querySelector('.pivi-thinking-options.pivi-inline-selector-dropdown-fixed')).not.toBeNull();
    await act(async () => thinkingButton?.click());
    expect(ownerDocument.querySelector('.pivi-thinking-options.pivi-inline-selector-dropdown-fixed')).toBeNull();

    await act(async () => mounted.dispose());
    expect(ownerDocument.querySelector('.pivi-inline-selector-dropdown-fixed')).toBeNull();
  });
});
