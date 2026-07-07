import {
  buildCompactionPrompt,
  buildCompactionSummary,
  getCompactionThresholdTokens,
  selectCompactionCutPoint,
  shouldAutoCompact,
  stripCompactCommand,
  type PiContextCompactionEntry,
} from '@pivi/pivi-agent-core/engine/pi/session/piContextCompaction';

function messageEntry(
  id: string,
  role: 'user' | 'assistant',
  content: string,
): PiContextCompactionEntry {
  return {
    id,
    type: 'message',
    message: { role, content },
  } as unknown as PiContextCompactionEntry;
}

function compactionEntry(id: string, summary: string): PiContextCompactionEntry {
  return {
    id,
    type: 'compaction',
    summary,
    firstKeptEntryId: 'kept',
    tokensBefore: 1_000,
  } as unknown as PiContextCompactionEntry;
}

describe('piContextCompaction', () => {
  it('strips compact commands while preserving optional user focus text', () => {
    expect(stripCompactCommand('/compact keep API decisions')).toBe('keep API decisions');
    expect(stripCompactCommand('  /compact  ')).toBeUndefined();
  });

  it('clamps compaction thresholds to the supported ratio range', () => {
    expect(getCompactionThresholdTokens(1_000, 0.1)).toBe(500);
    expect(getCompactionThresholdTokens(1_000, 0.99)).toBe(950);
    expect(getCompactionThresholdTokens(1_000, 0.8)).toBe(800);
  });

  it('selects old active-context entries before the recent keep window', () => {
    const entries = [
      messageEntry('m1', 'user', 'old '.repeat(1_000)),
      messageEntry('m2', 'assistant', 'middle '.repeat(1_000)),
      compactionEntry('c1', 'previous summary'),
      messageEntry('m3', 'user', 'after compact 1 '.repeat(1_000)),
      messageEntry('m4', 'assistant', 'after compact 2 '.repeat(1_000)),
      messageEntry('m5', 'user', 'after compact 3 '.repeat(1_000)),
      messageEntry('m6', 'assistant', 'after compact 4 '.repeat(1_000)),
      messageEntry('m7', 'user', 'recent '.repeat(1_000)),
    ];

    const cutPoint = selectCompactionCutPoint(entries, 1_000);

    expect(cutPoint?.firstKeptEntryId).toBe('m7');
    expect(cutPoint?.prefixEntries.map((entry) => entry.id)).toEqual([
      'c1',
      'm3',
      'm4',
      'm5',
      'm6',
    ]);
    expect(cutPoint?.tokensBefore).toBeGreaterThan(1_000);
  });

  it('builds prompts and stored summaries without exposing compacted raw history before the latest summary', () => {
    const prompt = buildCompactionPrompt([
      compactionEntry('c1', 'previous summary'),
      messageEntry('m3', 'user', 'continue from here'),
    ], 'preserve file decisions');

    expect(prompt).toContain('previous compaction summary');
    expect(prompt).toContain('previous summary');
    expect(prompt).toContain('preserve file decisions');
    expect(prompt).toContain('continue from here');
    expect(buildCompactionSummary(' new summary ')).toContain('new summary');
  });

  it('keeps auto-compaction decisions pure and leaf-scoped', () => {
    const providerUsage = {
      contextTokens: 900,
      contextWindow: 1_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 900,
      percentage: 90,
    };

    expect(shouldAutoCompact({
      enableAutoCompact: true,
      compactionInFlight: false,
      sessionLeafId: 'leaf-1',
      lastAttemptLeafId: null,
      providerUsage,
      storedConversationTokens: 100,
      thresholdRatio: 0.8,
    })).toBe(true);
    expect(shouldAutoCompact({
      enableAutoCompact: true,
      compactionInFlight: false,
      sessionLeafId: 'leaf-1',
      lastAttemptLeafId: 'leaf-1',
      providerUsage,
      storedConversationTokens: 1_000,
      thresholdRatio: 0.8,
    })).toBe(false);
  });
});
