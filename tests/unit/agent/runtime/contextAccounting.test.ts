import {
  calibrateTokenEstimate,
  getContextCalibration,
  observeProviderUsage,
  resetContextCalibration,
} from '@pivi/agent/runtime/contextAccounting';

describe('context accounting calibration', () => {
  beforeEach(() => resetContextCalibration());

  it('stores an in-memory ratio per model', () => {
    expect(observeProviderUsage('openai/model-a', 120_000, 150_000)).toBe(0.8);
    expect(getContextCalibration('openai/model-a')).toBe(0.8);
    expect(getContextCalibration('anthropic/model-b')).toBe(1);
    expect(calibrateTokenEstimate(6_000, 0.8)).toBe(4_800);
  });

  it('clamps anomalous observations and resets without persistence', () => {
    expect(observeProviderUsage('low', 10, 100)).toBe(0.6);
    expect(observeProviderUsage('high', 200, 100)).toBe(1.5);
    resetContextCalibration();
    expect(getContextCalibration('low')).toBe(1);
    expect(getContextCalibration('high')).toBe(1);
  });
});
