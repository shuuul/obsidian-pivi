import { type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import type { I18n } from '../i18n';
import { I18nProvider } from '../i18n';
import type { PresentationPlatform } from '../platform';
import { PresentationPlatformProvider } from '../platform';
import { InlineEditBox, type InlineEditBoxProps } from '../selectionToolbar/InlineEditBox';
import { SelectionToolbar, type SelectionToolbarProps } from '../selectionToolbar/SelectionToolbar';

export type SelectionToolbarSurfaceProps =
  | ({ mode: 'toolbar' } & SelectionToolbarProps)
  | ({ mode: 'inline-edit' } & InlineEditBoxProps);

export interface MountSelectionToolbarSurfaceOptions {
  container: HTMLElement;
  i18n: I18n;
  platform: PresentationPlatform;
  props: SelectionToolbarSurfaceProps;
}

function renderSelectionToolbarSurface(
  props: SelectionToolbarSurfaceProps,
): ReactNode {
  if (props.mode === 'toolbar') {
    const { mode: _mode, ...toolbarProps } = props;
    return <SelectionToolbar {...toolbarProps} />;
  }
  const { mode: _mode, ...inlineEditProps } = props;
  return <InlineEditBox {...inlineEditProps} />;
}

export function mountSelectionToolbarSurface(
  options: MountSelectionToolbarSurfaceOptions,
): SelectionToolbarMountedSurface {
  const root: Root = createRoot(options.container);
  let disposed = false;

  const render = (props: SelectionToolbarSurfaceProps): void => {
    if (disposed) {
      return;
    }
    flushSync(() => {
      root.render(
        <PresentationPlatformProvider platform={options.platform}>
          <I18nProvider i18n={options.i18n}>
            {renderSelectionToolbarSurface(props)}
          </I18nProvider>
        </PresentationPlatformProvider>,
      );
    });
    queueMicrotask(() => {
      options.container.dispatchEvent(new CustomEvent('pivi-selection-toolbar-mounted'));
    });
  };

  render(options.props);

  return {
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      root.unmount();
    },
    update(props: SelectionToolbarSurfaceProps) {
      render(props);
    },
  };
}

export interface SelectionToolbarMountedSurface {
  dispose(): Promise<void>;
  update(props: SelectionToolbarSurfaceProps): void;
}
