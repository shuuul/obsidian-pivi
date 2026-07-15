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

  it('prefers explicit lifecycle facts without inferring unavailable states', () => {
    expect(resolveToolActivityStatus({ status: 'error', activityStatus: 'cancelled' })).toBe('cancelled');
    expect(resolveSubagentActivityStatus({ status: 'running', activityStatus: 'waiting' })).toBe('waiting');
  });
});
