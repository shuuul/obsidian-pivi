import { measureStartupPhase } from '@/app/startupPerformance';

describe('measureStartupPhase', () => {
  it('records a named measure and preserves the action result', async () => {
    const result = await measureStartupPhase('workspace', async () => 'ready');

    expect(result).toBe('ready');
    const entries = performance.getEntriesByName('pivi:startup:workspace', 'measure');
    expect(entries.length).toBeGreaterThan(0);
    performance.clearMeasures('pivi:startup:workspace');
  });

  it('records failed phases without swallowing the error', async () => {
    await expect(measureStartupPhase('settings', async () => {
      throw new Error('settings failed');
    })).rejects.toThrow('settings failed');

    expect(performance.getEntriesByName('pivi:startup:settings', 'measure')).not.toHaveLength(0);
    performance.clearMeasures('pivi:startup:settings');
  });
});
