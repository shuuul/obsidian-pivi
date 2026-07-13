import type { InlineEditService } from '@pivi/pivi-agent-core/runtime/auxTypes';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { I18n } from '../i18n';
import { I18nProvider } from '../i18n';
import type { InlineEditPort } from '../ports';
import { createInlineEditController, type InlineEditContext, type InlineEditController } from './controller';
import { InlineEditView } from './InlineEditView';
import type { InlineEditState } from './reducer';

export interface InlineEditMountOptions {
  container: HTMLElement;
  ownerDocument: Document;
  ownerWindow: Window;
  i18n: I18n;
  port: InlineEditPort;
  context: InlineEditContext;
  notePath: string;
  contextFiles?: () => string[];
  service?: InlineEditService;
  modelOverride?: string | null;
  accept: (text: string) => void;
  onStateChange?: (state: InlineEditState) => void;
  reject: () => void;
}

export interface MountedInlineEdit {
  controller: InlineEditController;
  dispose: () => void;
}

let activeInlineEdit: { dispose: () => void; reject: () => void } | null = null;

export function mountInlineEdit(options: InlineEditMountOptions): MountedInlineEdit {
  if (options.container.ownerDocument !== options.ownerDocument) {
    throw new Error('Inline edit container must belong to its owner document.');
  }
  if (options.ownerWindow.document !== options.ownerDocument) {
    throw new Error('Inline edit owner window must match its owner document.');
  }
  activeInlineEdit?.reject();
  activeInlineEdit?.dispose();
  const controller = createInlineEditController(options.port, {
    context: options.context,
    notePath: options.notePath,
    service: options.service,
    modelOverride: options.modelOverride,
    contextFiles: options.contextFiles,
    onStateChange: options.onStateChange,
  });
  const root = createRoot(options.container);
  flushSync(() => root.render(<I18nProvider i18n={options.i18n}><InlineEditView controller={controller} onAccept={options.accept} onReject={options.reject} /></I18nProvider>));
  let disposed = false;
  let active: { dispose: () => void; reject: () => void };
  const mounted: MountedInlineEdit = {
    controller,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.cancel();
      root.unmount();
      if (activeInlineEdit === active) activeInlineEdit = null;
    },
  };
  active = {
    dispose: mounted.dispose,
    reject() {
      controller.reject();
      options.reject();
    },
  };
  activeInlineEdit = active;
  return mounted;
}
