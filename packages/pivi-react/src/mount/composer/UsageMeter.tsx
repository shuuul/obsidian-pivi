import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';
import {
  calculateContextUsagePercentage,
  calculateUsagePercentage,
} from '@pivi/pivi-agent-core/foundation/usage';

import { useT } from '../../i18n';
import { formatCompactTokenCount } from '../../usage/usageInfo';

export function UsageMeter({ usage }: { usage: UsageInfo | null }) {
  const t = useT();
  const contextTokens = usage?.contextTokens ?? 0;
  const contextLimit = usage?.contextWindow ?? 0;
  const pressurePercentage = usage ? calculateContextUsagePercentage(usage) : 0;
  const totalPercentage = calculateUsagePercentage(contextTokens, contextLimit);

  if (!(contextTokens > 0)) return null;
  const contextLengthUnknown = contextLimit <= 0;
  const label = contextLengthUnknown
    ? t('chat.usage.unknownContextLength')
    : t('chat.usage.input', {
        tokens: formatCompactTokenCount(contextTokens),
        limit: formatCompactTokenCount(contextLimit),
        percentage: totalPercentage,
      });

  return (
    <div className="pivi-context-meter">
      <span
        aria-label={label}
        className={`pivi-context-meter-gauge pivi-context-meter-gauge-input${contextLengthUnknown ? ' unknown' : pressurePercentage > 80 ? ' warning' : ''}`}
        data-tooltip={label}
        role="img"
      >
        <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
          <path className="pivi-meter-bg" d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5" fill="none" strokeLinecap="round" strokeWidth="2" />
          <path
            className="pivi-meter-fill pivi-meter-fill-input"
            d="M 1.94 11.5 A 7 7 0 1 1 14.06 11.5"
            fill="none"
            pathLength="100"
            strokeDasharray="100"
            strokeDashoffset={100 - totalPercentage}
            strokeLinecap="round"
            strokeWidth="2"
          />
          {contextLengthUnknown
            ? <text className="pivi-meter-unknown-mark" textAnchor="middle" x="8" y="11.5">!</text>
            : null}
        </svg>
      </span>
    </div>
  );
}
