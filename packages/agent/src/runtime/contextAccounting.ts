const MIN_CALIBRATION_RATIO = 0.6;
const MAX_CALIBRATION_RATIO = 1.5;

const calibrationByModel = new Map<string, number>();

export function getContextCalibration(modelKey: string): number {
  return calibrationByModel.get(modelKey) ?? 1;
}

export function observeProviderUsage(
  modelKey: string,
  providerTotal: number,
  localEstimate: number,
): number {
  if (!modelKey || !(providerTotal > 0) || !(localEstimate > 0)) {
    return getContextCalibration(modelKey);
  }
  const ratio = Math.min(
    MAX_CALIBRATION_RATIO,
    Math.max(MIN_CALIBRATION_RATIO, providerTotal / localEstimate),
  );
  calibrationByModel.set(modelKey, ratio);
  return ratio;
}

/** Test/plugin-lifecycle seam; calibration is intentionally memory-only. */
export function resetContextCalibration(): void {
  calibrationByModel.clear();
}

export function calibrateTokenEstimate(tokens: number, ratio: number): number {
  return Math.max(0, Math.round(tokens * ratio));
}
