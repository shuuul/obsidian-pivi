import { shouldApplyUsageStreamChunk } from '@/ui/chat/stream/UsagePresenter';

describe('shouldApplyUsageStreamChunk', () => {
  it('rejects when usage updates are ignored', () => {
    expect(shouldApplyUsageStreamChunk({
      chunkSessionId: 's1',
      currentSessionId: 's1',
      subagentsSpawnedThisStream: 0,
      ignoreUsageUpdates: true,
    })).toBe(false);
  });

  it('rejects cumulative usage while subagents ran', () => {
    expect(shouldApplyUsageStreamChunk({
      chunkSessionId: 's1',
      currentSessionId: 's1',
      subagentsSpawnedThisStream: 2,
      ignoreUsageUpdates: false,
    })).toBe(false);
  });

  it('accepts the usage refresh immediately following compaction', () => {
    expect(shouldApplyUsageStreamChunk({
      chunkSessionId: 's1',
      currentSessionId: 's1',
      subagentsSpawnedThisStream: 2,
      ignoreUsageUpdates: false,
      followsCompaction: true,
    })).toBe(true);
  });

  it('rejects usage from a different session', () => {
    expect(shouldApplyUsageStreamChunk({
      chunkSessionId: 'other',
      currentSessionId: 'current',
      subagentsSpawnedThisStream: 0,
      ignoreUsageUpdates: false,
    })).toBe(false);
  });

  it('accepts usage for the active session', () => {
    expect(shouldApplyUsageStreamChunk({
      chunkSessionId: 'current',
      currentSessionId: 'current',
      subagentsSpawnedThisStream: 0,
      ignoreUsageUpdates: false,
    })).toBe(true);
  });
});
