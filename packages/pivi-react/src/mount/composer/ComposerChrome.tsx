import { useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon, QueueMessageIcon } from '../../icons';
import { usePresentationPlatform } from '../../platform';
import type { ChatUiSnapshot } from '../../store';
import type { ComposerChromeActions } from '../activeChatUiBridge';
import { CacheHitMeter } from './CacheHitMeter';
import {
  ExternalContextControl,
  ModelSelector,
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
  const platform = usePresentationPlatform();
  const sendWrapRef = useRef<HTMLDivElement>(null);
  const { composer } = snapshot;
  const queuesMessage = snapshot.isStreaming && composer.canSend;
  const stopsResponse = snapshot.isStreaming && !composer.canSend;
  const sendDisabled = !snapshot.isStreaming && !composer.canSend;
  const sendTooltip = queuesMessage
    ? t('chat.composer.queueTitle')
    : stopsResponse
      ? t('chat.composer.stopTitle')
      : composer.canSend
        ? t('chat.composer.sendTitle')
        : t('chat.composer.sendEmptyTitle');
  useEffect(() => {
    const wrap = sendWrapRef.current;
    if (!wrap || !actions) return;
    platform.attachTooltip(wrap, sendTooltip);
  }, [actions, platform, sendTooltip]);
  if (!actions) return null;
  return (
    <div className="pivi-input-toolbar">
      <ModelSelector onChange={actions.setModel} options={composer.modelOptions} value={composer.model} />
      <ThinkingSelector
        adaptive={composer.adaptiveReasoning}
        defaultValue={composer.defaultReasoningValue}
        onChange={actions.setThinkingLevel}
        options={composer.thinkingOptions}
        value={composer.thinkingLevel}
      />
      <ExternalContextControl actions={actions} snapshot={snapshot} />
      <div className="pivi-input-action-group">
        {snapshot.showCacheHitRate ? <CacheHitMeter usage={snapshot.usage} /> : null}
        <UsageMeter usage={snapshot.usage} />
        <div className="pivi-send-button-wrap" ref={sendWrapRef}>
          <button
            aria-label={queuesMessage
              ? t('chat.composer.queueAria')
              : stopsResponse
              ? t('chat.composer.stopAria')
              : composer.canSend
                ? t('chat.composer.sendAria')
                : t('chat.composer.sendEmptyAria')}
            className={`pivi-send-button pivi-send-${queuesMessage ? 'queue' : stopsResponse ? 'streaming' : composer.canSend ? 'ready' : 'disabled'}`}
            disabled={sendDisabled}
            onClick={stopsResponse ? actions.stop : actions.send}
            type="button"
          >
            {queuesMessage
              ? <QueueMessageIcon />
              : <PlatformIcon name={stopsResponse ? 'square' : 'arrow-up'} />}
          </button>
        </div>
      </div>
    </div>
  );
}
