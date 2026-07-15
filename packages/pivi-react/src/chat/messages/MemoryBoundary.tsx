import type { CheckpointPresentation } from '@pivi/pivi-agent-core/foundation';
import { useId, useState } from 'react';

import { useT } from '../../i18n/I18nProvider';

function formatApproximateTokens(tokens: number): string {
  if (tokens < 1_000) return `~${Math.max(0, Math.round(tokens))}`;
  return `~${Math.round(tokens / 1_000)}K`;
}

export function MemoryBoundary({
  checkpoint,
  kind,
  summary,
  tokensAfter,
  tokensBefore,
}: {
  readonly checkpoint?: CheckpointPresentation;
  readonly kind: 'compaction' | 'older-history';
  readonly summary?: string;
  readonly tokensAfter?: number;
  readonly tokensBefore?: number;
}) {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();
  const before = kind === 'compaction'
    && typeof tokensBefore === 'number'
    && Number.isFinite(tokensBefore)
    ? formatApproximateTokens(tokensBefore)
    : null;
  const after = kind === 'compaction'
    && typeof tokensAfter === 'number'
    && Number.isFinite(tokensAfter)
    ? formatApproximateTokens(tokensAfter)
    : null;
  const label = kind === 'compaction'
    ? t('chat.stream.sessionCompacted')
    : t('chat.stream.earlierHistory');
  const hasDetails = kind === 'compaction' && Boolean(checkpoint || summary?.trim());
  const accessibleLabel = before && after
    ? t('chat.stream.compactionTokenTransition', { after, before })
    : label;
  const chipContent = (
    <>
      <span className="pivi-memory-chip-label">{label}</span>
      {before && after ? (
        <span aria-hidden="true" className="pivi-memory-chip-transition">{before} → {after}</span>
      ) : null}
    </>
  );

  return (
    <div className="pivi-memory-root">
      <div
        aria-label={accessibleLabel}
        className={`pivi-memory-boundary${kind === 'compaction' ? ' pivi-compact-boundary' : ' pivi-history-boundary'}`}
        role="separator"
      />
      {hasDetails ? (
        <button
          aria-controls={panelId}
          aria-expanded={isExpanded}
          aria-label={isExpanded
            ? t('chat.stream.collapseCheckpoint')
            : t('chat.stream.expandCheckpoint')}
          className="pivi-memory-chip pivi-memory-chip-button"
          onClick={() => setIsExpanded((value) => !value)}
          type="button"
        >
          {chipContent}
        </button>
      ) : <span className="pivi-memory-chip">{chipContent}</span>}
      {hasDetails && isExpanded ? (
        <section
          aria-label={t('chat.stream.checkpointDetails')}
          className="pivi-checkpoint-panel"
          id={panelId}
        >
          <p className="pivi-checkpoint-summary">
            {checkpoint?.continuationSummary ?? summary}
          </p>
          {checkpoint ? <CheckpointDetails checkpoint={checkpoint} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function CheckpointDetails({ checkpoint }: { checkpoint: CheckpointPresentation }) {
  const t = useT();
  return (
    <div className="pivi-checkpoint-details">
      {checkpoint.goal ? (
        <CheckpointSection label={t('chat.stream.checkpointGoal')} values={[checkpoint.goal]} />
      ) : null}
      <CheckpointSection label={t('chat.stream.checkpointConstraints')} values={checkpoint.constraints} />
      <CheckpointSection label={t('chat.stream.checkpointDecisions')} values={checkpoint.decisions} />
      <CheckpointSection
        label={t('chat.stream.checkpointArtifacts')}
        values={checkpoint.artifacts.map((artifact) => (
          artifact.vaultPath ? `${artifact.label} — ${artifact.vaultPath}` : artifact.label
        ))}
      />
      <CheckpointSection label={t('chat.stream.checkpointOpenWork')} values={checkpoint.openWork} />
      <CheckpointSection label={t('chat.stream.checkpointQuestions')} values={checkpoint.unresolvedQuestions} />
      <CheckpointSection label={t('chat.stream.checkpointNextSteps')} values={checkpoint.nextSteps} />
      <dl className="pivi-checkpoint-meta">
        <div>
          <dt>{t('chat.stream.checkpointSource')}</dt>
          <dd>{t('chat.stream.checkpointSourceBounds', {
            first: checkpoint.source.firstEntryId,
            kept: checkpoint.source.firstKeptEntryId,
            last: checkpoint.source.lastEntryId,
          })}</dd>
        </div>
        <div>
          <dt>{t('chat.stream.checkpointEstimate')}</dt>
          <dd>{formatApproximateTokens(checkpoint.tokenEstimate)}</dd>
        </div>
      </dl>
    </div>
  );
}

function CheckpointSection({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <section className="pivi-checkpoint-section">
      <h4>{label}</h4>
      <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
    </section>
  );
}
