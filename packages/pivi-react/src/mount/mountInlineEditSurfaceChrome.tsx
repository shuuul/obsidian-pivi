import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import type { I18n } from '../i18n';
import { I18nProvider } from '../i18n';
import type { PresentationPlatform } from '../platform';
import { PresentationPlatformProvider } from '../platform';
import type { ComposerOptionSnapshot } from '../store';
import { ModelSelector, ThinkingSelector } from './composer/ComposerSelectors';

export interface InlineEditSurfaceChromeProps {
  model: string;
  modelOptions: readonly ComposerOptionSnapshot[];
  thinkingLevel: string;
  thinkingOptions: readonly ComposerOptionSnapshot[];
  adaptiveReasoning: boolean;
  defaultReasoningValue: string;
  disabled?: boolean;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
}

export interface MountInlineEditSurfaceChromeOptions {
  container: HTMLElement;
  i18n: I18n;
  platform: PresentationPlatform;
  props: InlineEditSurfaceChromeProps;
}

export interface InlineEditSurfaceChromeHandle {
  update(props: InlineEditSurfaceChromeProps): void;
  dispose(): Promise<void>;
}

function renderInlineEditSurfaceChrome(props: InlineEditSurfaceChromeProps, portalRoot: HTMLElement) {
  return (
    <div className="pivi-inline-edit-surface-selectors">
      <ModelSelector
        onChange={props.onModelChange}
        options={props.modelOptions}
        portalRoot={portalRoot}
        value={props.model}
      />
      <ThinkingSelector
        adaptive={props.adaptiveReasoning}
        defaultValue={props.defaultReasoningValue}
        onChange={props.onThinkingChange}
        options={props.thinkingOptions}
        portalRoot={portalRoot}
        value={props.thinkingLevel}
      />
    </div>
  );
}

export function mountInlineEditSurfaceChrome(
  options: MountInlineEditSurfaceChromeOptions,
): InlineEditSurfaceChromeHandle {
  const root: Root = createRoot(options.container);
  let disposed = false;

  const render = (props: InlineEditSurfaceChromeProps): void => {
    if (disposed) {
      return;
    }
    flushSync(() => {
      root.render(
        <PresentationPlatformProvider platform={options.platform}>
          <I18nProvider i18n={options.i18n}>
            {renderInlineEditSurfaceChrome(props, options.container.ownerDocument.body)}
          </I18nProvider>
        </PresentationPlatformProvider>,
      );
    });
  };

  render(options.props);

  return {
    update(props: InlineEditSurfaceChromeProps) {
      render(props);
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      root.unmount();
    },
  };
}
