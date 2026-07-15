import { useT } from '../../i18n/I18nProvider';

function formatApproximateTokens(tokens: number): string {
  if (tokens < 1_000) return `~${Math.max(0, Math.round(tokens))}`;
  return `~${Math.round(tokens / 1_000)}K`;
}

export function MemoryBoundary({
  kind,
  tokensAfter,
  tokensBefore,
}: {
  readonly kind: 'compaction' | 'older-history';
  readonly tokensAfter?: number;
  readonly tokensBefore?: number;
}) {
  const t = useT();
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

  return (
    <div
      aria-label={before && after
        ? t('chat.stream.compactionTokenTransition', { after, before })
        : label}
      className={`pivi-memory-boundary${kind === 'compaction' ? ' pivi-compact-boundary' : ' pivi-history-boundary'}`}
      role="separator"
    >
      <span className="pivi-memory-chip">
        <span className="pivi-memory-chip-label">{label}</span>
        {before && after ? (
          <span aria-hidden="true" className="pivi-memory-chip-transition">{before} → {after}</span>
        ) : null}
      </span>
    </div>
  );
}
