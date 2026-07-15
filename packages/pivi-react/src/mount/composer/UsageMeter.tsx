import type {
  ContextEnvelopeValue,
  UsageInfo,
} from '@pivi/pivi-agent-core/foundation';
import { calculateContextUsagePercentage } from '@pivi/pivi-agent-core/foundation/usage';
import { useEffect, useId, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { formatCompactTokenCount } from '../../usage/usageInfo';

function formatEnvelopeValue(value: ContextEnvelopeValue): string {
  const tokens = formatCompactTokenCount(value.tokens);
  return value.source === 'authoritative' ? tokens : `~${tokens}`;
}

export function UsageMeter({ usage }: { usage: UsageInfo | null }) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const contextTokens = usage?.contextTokens ?? 0;
  const contextLimit = usage?.contextWindow ?? 0;
  const contextPercentage = usage ? calculateContextUsagePercentage(usage) : 0;
  const envelope = usage?.contextEnvelope;

  useEffect(() => {
    if (!isOpen || !rootRef.current) return;
    const ownerDocument = rootRef.current.ownerDocument;
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof ownerDocument.defaultView!.Node
        && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    ownerDocument.addEventListener('keydown', closeFromEscape);
    ownerDocument.addEventListener('pointerdown', closeFromOutside);
    return () => {
      ownerDocument.removeEventListener('keydown', closeFromEscape);
      ownerDocument.removeEventListener('pointerdown', closeFromOutside);
    };
  }, [isOpen]);

  if (!(contextTokens > 0)) return null;
  const contextLengthUnknown = contextLimit <= 0;
  const label = contextLengthUnknown
    ? t('chat.usage.unknownContextLength')
    : t('chat.usage.input', {
        tokens: formatCompactTokenCount(contextTokens),
        limit: formatCompactTokenCount(contextLimit),
        percentage: contextPercentage,
      });
  const total: ContextEnvelopeValue = envelope?.total ?? {
    source: usage?.contextTokensIsAuthoritative ? 'authoritative' : 'estimated',
    tokens: contextTokens,
  };

  return (
    <div className="pivi-context-meter" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-label={label}
        className={`pivi-context-meter-gauge pivi-context-meter-gauge-input${contextLengthUnknown ? ' unknown' : contextPercentage > 80 ? ' warning' : ''}`}
        data-tooltip={label}
        onClick={() => setIsOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
          <path className="pivi-meter-bg" d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5" fill="none" strokeLinecap="round" strokeWidth="2" />
          <path
            className="pivi-meter-fill pivi-meter-fill-input"
            d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5"
            fill="none"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - contextPercentage}
            strokeLinecap="round"
            strokeWidth="2"
          />
          {contextLengthUnknown
            ? <text className="pivi-meter-unknown-mark" textAnchor="middle" x="8" y="11.5">!</text>
            : null}
        </svg>
      </button>
      {isOpen ? (
        <div
          aria-label={t('chat.usage.inspectorTitle')}
          className="pivi-context-inspector"
          id={panelId}
          role="dialog"
        >
          <div className="pivi-context-inspector-header">
            <span>{t('chat.usage.inspectorTitle')}</span>
            <button
              aria-label={t('chat.usage.closeInspector')}
              className="pivi-context-inspector-close"
              onClick={() => {
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
              type="button"
            >×</button>
          </div>
          <dl className="pivi-context-inspector-values">
            <InspectorValue label={t('chat.usage.total')} value={formatEnvelopeValue(total)} />
            {envelope ? (
              <>
                <InspectorValue label={t('chat.usage.system')} value={formatEnvelopeValue(envelope.system)} />
                <InspectorValue label={t('chat.usage.recentConversation')} value={formatEnvelopeValue(envelope.recentConversation)} />
                <InspectorValue label={t('chat.usage.selectedContext')} value={formatEnvelopeValue(envelope.selectedContext)} />
                <InspectorValue label={t('chat.usage.toolAndAgentResults')} value={formatEnvelopeValue(envelope.toolAndAgentResults)} />
                <InspectorValue label={t('chat.usage.checkpoints')} value={formatEnvelopeValue(envelope.checkpoints)} />
                <InspectorValue label={t('chat.usage.usableInput')} value={`~${formatCompactTokenCount(envelope.usableInputTokens)}`} />
                <InspectorValue label={t('chat.usage.compactionTrigger')} value={`~${formatCompactTokenCount(envelope.compactionTriggerTokens)}`} />
                <InspectorValue label={t('chat.usage.reservedOutput')} value={formatEnvelopeValue(envelope.reservedOutput)} />
                <InspectorValue label={t('chat.usage.compactionReserve')} value={formatEnvelopeValue(envelope.compactionReserve)} />
                <InspectorValue label={t('chat.usage.safetyMargin')} value={formatEnvelopeValue(envelope.safetyMargin)} />
              </>
            ) : null}
          </dl>
          <p className="pivi-context-inspector-note">{t('chat.usage.estimateNote')}</p>
        </div>
      ) : null}
    </div>
  );
}

function InspectorValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="pivi-context-inspector-value">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
