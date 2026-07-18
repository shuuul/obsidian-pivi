import {
  resolveSubagentActivityStatus,
  resolveToolActivityStatus,
} from '@pivi/pivi-agent-core/foundation';

describe('activity status mapping', () => {
  it.each([
    ['running', 'running'],
    ['completed', 'completed'],
    ['error', 'failed'],
    ['blocked', 'failed'],
  ] as const)('maps legacy tool status %s to %s', (status, expected) => {
    expect(resolveToolActivityStatus({ status })).toBe(expected);
  });

  it.each([
    ['pending', 'queued'],
    ['running', 'running'],
    ['completed', 'completed'],
    ['error', 'failed'],
    ['orphaned', 'orphaned'],
  ] as const)('maps stored async Agent status %s to %s', (asyncStatus, expected) => {
    expect(resolveSubagentActivityStatus({ asyncStatus, status: 'running' })).toBe(expected);
  });

  it('prefers terminal asyncStatus over stale running activityStatus', () => {
    expect(resolveSubagentActivityStatus({
      asyncStatus: 'orphaned',
      status: 'running',
      activityStatus: 'running',
    })).toBe('orphaned');
    expect(resolveSubagentActivityStatus({
      asyncStatus: 'completed',
      status: 'running',
      activityStatus: 'running',
    })).toBe('completed');
    expect(resolveSubagentActivityStatus({
      asyncStatus: 'error',
      status: 'running',
      activityStatus: 'queued',
    })).toBe('failed');
  });

  it('prefers explicit lifecycle facts without inferring unavailable states', () => {
    expect(resolveToolActivityStatus({ status: 'error', activityStatus: 'cancelled' })).toBe('cancelled');
    expect(resolveSubagentActivityStatus({
      asyncStatus: 'error',
      status: 'error',
      activityStatus: 'cancelled',
    })).toBe('cancelled');
    expect(resolveSubagentActivityStatus({ status: 'running', activityStatus: 'waiting' })).toBe('waiting');
  });
});
