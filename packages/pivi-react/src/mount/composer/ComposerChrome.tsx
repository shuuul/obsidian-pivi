import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatUiSnapshot } from '../../store';
import type { ComposerChromeActions } from '../activeChatUiBridge';
import {
  ExternalContextControl,
  ModelSelector,
  ModeSelector,
  ThinkingSelector,
} from './ComposerSelectors';
import { UsageMeter } from './UsageMeter';

export function ComposerChrome({
  snapshot,
  actions,
}: {
  snapshot: ChatUiSnapshot;
  actions: ComposerChromeActions | null;
}) {
  const t = useT();
  if (!actions) return null;
  const { composer } = snapshot;
  return (
    <div className="pivi-input-toolbar">
      <ModelSelector onChange={actions.setModel} options={composer.modelOptions} value={composer.model} />
      <ThinkingSelector
        adaptive={composer.adaptiveReasoning}
        defaultValue={composer.defaultReasoningValue}
        onChange={composer.adaptiveReasoning ? actions.setThinkingLevel : actions.setThinkingBudget}
        options={composer.thinkingOptions}
        value={composer.adaptiveReasoning ? composer.thinkingLevel : composer.thinkingBudget}
      />
      <ExternalContextControl actions={actions} snapshot={snapshot} />
      <ModeSelector
        activeValue={composer.modeActiveValue}
        label={composer.modeLabel}
        onChange={actions.setMode}
        options={composer.modeOptions}
        value={composer.mode}
      />
      <div className="pivi-input-action-group">
        <UsageMeter usage={snapshot.usage} />
        <div className="pivi-send-button-wrap">
          <button
            aria-label={snapshot.isStreaming
              ? t('chat.composer.stopAria')
              : composer.canSend
                ? t('chat.composer.sendAria')
                : t('chat.composer.sendEmptyAria')}
            className={`pivi-send-button pivi-send-${snapshot.isStreaming ? 'streaming' : composer.canSend ? 'ready' : 'disabled'}`}
            disabled={!snapshot.isStreaming && !composer.canSend}
            onClick={snapshot.isStreaming ? actions.stop : actions.send}
            title={snapshot.isStreaming
              ? t('chat.composer.stopTitle')
              : composer.canSend
                ? t('chat.composer.sendTitle')
                : t('chat.composer.sendEmptyTitle')}
            type="button"
          >
            <PlatformIcon name={snapshot.isStreaming ? 'square' : 'arrow-up'} />
          </button>
        </div>
      </div>
    </div>
  );
}
