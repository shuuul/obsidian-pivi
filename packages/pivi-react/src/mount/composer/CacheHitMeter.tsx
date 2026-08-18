import type { UsageInfo } from '@pivi/agent/foundation';
import { calculateCacheHitPercentage } from '@pivi/agent/foundation/usage';

import { useT } from '../../i18n';
import { formatCompactTokenCount } from '../../usage/usageInfo';
import { ContextMeterGauge } from './ContextMeterGauge';

export function CacheHitMeter({ usage }: { usage: UsageInfo | null }) {
  const t = useT();
  if (!usage) return null;
  const percentage = calculateCacheHitPercentage(usage);
  if (percentage === null) return null;
  const label = t('chat.usage.cacheHit', {
    cached: formatCompactTokenCount(usage.cacheReadInputTokens ?? 0),
    percentage,
    prompt: formatCompactTokenCount(usage.contextTokens),
  });

  return (
    <div className="pivi-context-meter pivi-cache-meter">
      <ContextMeterGauge
        ariaLabel={label}
        fillClassName="pivi-meter-fill-cache"
        percentage={percentage}
      />
    </div>
  );
}
