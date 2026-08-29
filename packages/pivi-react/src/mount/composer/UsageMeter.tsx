import type { UsageInfo } from '@pivi/agent/runtime/chatTypes';
import {
  calculateContextUsagePercentage,
  calculateUsagePercentage,
} from '@pivi/agent/runtime/usage';

import { useT } from '../../i18n';
import { formatCompactTokenCount } from '../../usage/usageInfo';
import { ContextMeterGauge } from './ContextMeterGauge';

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
      <ContextMeterGauge
        ariaLabel={label}
        fillClassName="pivi-meter-fill-input"
        percentage={totalPercentage}
        unknown={contextLengthUnknown}
        warning={!contextLengthUnknown && pressurePercentage > 80}
      />
    </div>
  );
}
