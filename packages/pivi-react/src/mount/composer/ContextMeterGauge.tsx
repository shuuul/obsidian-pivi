const METER_PATH = 'M 1.94 11.5 A 7 7 0 1 1 14.06 11.5';

export function ContextMeterGauge({
  ariaLabel,
  fillClassName,
  percentage,
  unknown = false,
  warning = false,
}: {
  ariaLabel: string;
  fillClassName: string;
  percentage: number;
  unknown?: boolean;
  warning?: boolean;
}) {
  const stateClass = unknown ? ' unknown' : warning ? ' warning' : '';
  return (
    <span
      aria-label={ariaLabel}
      className={`pivi-context-meter-gauge${stateClass}`}
      data-tooltip={ariaLabel}
      role="img"
    >
      <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
        <path className="pivi-meter-bg" d={METER_PATH} fill="none" strokeLinecap="round" strokeWidth="2" />
        <path
          className={`pivi-meter-fill ${fillClassName}`}
          d={METER_PATH}
          fill="none"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - percentage}
          strokeLinecap="round"
          strokeWidth="2"
        />
        {unknown
          ? <text className="pivi-meter-unknown-mark" textAnchor="middle" x="8" y="11.5">!</text>
          : null}
      </svg>
    </span>
  );
}
