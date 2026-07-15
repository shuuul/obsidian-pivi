import {
  buildCheckpoint,
  buildCompactionPrompt,
  buildCompactionSummary,
  COMPACTION_SYSTEM_PROMPT,
  estimateActiveContextTokens,
  estimateAgentMessageTokens,
  estimateTextTokens,
  findLatestCheckpoint,
  getCompactionThresholdTokens,
  PiContextTokenIndex,
  renderCheckpoint,
  selectCompactionCutPoint,
  shouldAutoCompact,
  stripCompactCommand,
  type PiContextCompactionEntry,
} from '@pivi/pivi-agent-core/engine/pi/session/piContextCompaction';
import type { Checkpoint } from '@pivi/pivi-agent-core/session/continuationSchemas';

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
  const checkpointText = `## Continuation summary
Continue schema integration.

## Goal
Ship checkpoints

## Constraints
- Keep legacy summaries

## Decisions
- Use details

## Artifacts
- Spec :: specs/005.md

## Open work
- Wire runtime

## Unresolved questions
None

## Next steps
- Run tests`;

  it('strips compact commands while preserving optional user focus text', () => {
    expect(stripCompactCommand('/compact keep API decisions')).toBe('keep API decisions');
    expect(stripCompactCommand('  /compact  ')).toBeUndefined();
  });

  it('clamps compaction thresholds to the supported ratio range', () => {
    expect(getCompactionThresholdTokens(1_000, 0.1)).toBe(500);
    expect(getCompactionThresholdTokens(1_000, 0.99)).toBe(950);
    expect(getCompactionThresholdTokens(1_000, 0.8)).toBe(800);
  });

  it('estimates CJK, code, JSON, and tool structures conservatively', () => {
    const ascii = estimateTextTokens('a'.repeat(120));
    const cjk = estimateTextTokens('知识管理系统'.repeat(20));
    const code = estimateTextTokens(`\`\`\`ts\n${'const value = input[index];\n'.repeat(5)}\`\`\``);
    const json = estimateTextTokens(JSON.stringify({ items: ['alpha', 'beta'], ok: true }));
    const toolCall = estimateAgentMessageTokens({
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'obsidian_read',
        arguments: { path: '知识库/项目.md', lineStart: 1, lineEnd: 200 },
      }],
    } as unknown as Parameters<typeof estimateAgentMessageTokens>[0]);

    expect(ascii).toBe(30);
    expect(cjk).toBe(120);
    expect(code).toBeGreaterThan(30);
    expect(json).toBeGreaterThan(Math.ceil(JSON.stringify({ items: ['alpha', 'beta'], ok: true }).length / 4));
    expect(toolCall).toBeGreaterThan(30);
  });

  it('updates cached entry estimates and prefix sums after append, replacement, and truncate', () => {
    const first = messageEntry('m1', 'user', 'a'.repeat(40));
    const second = messageEntry('m2', 'assistant', 'b'.repeat(80));
    const index = new PiContextTokenIndex();

    index.sync([first]);
    const firstTotal = index.tokensBetween(0);
    index.sync([first, second]);
    const appendedTotal = index.tokensBetween(0);
    expect(appendedTotal).toBe(firstTotal + index.tokensAt(1));

    const replacement = messageEntry('m2', 'assistant', '知识'.repeat(100));
    index.sync([first, replacement]);
    expect(index.tokensBetween(1)).toBe(index.tokensAt(1));
    expect(index.tokensBetween(0)).toBeGreaterThan(appendedTotal);

    index.sync([first]);
    expect(index.tokensBetween(0)).toBe(firstTotal);
  });

  it('estimates only the active context around the latest compaction', () => {
    const old = messageEntry('old', 'user', 'x'.repeat(4_000));
    const kept = messageEntry('kept', 'assistant', 'y'.repeat(400));
    const compacted = {
      ...compactionEntry('c1', 'durable summary'),
      firstKeptEntryId: 'kept',
    } as PiContextCompactionEntry;
    const recent = messageEntry('recent', 'user', 'z'.repeat(200));

    const activeTokens = estimateActiveContextTokens([old, kept, compacted, recent]);
    const withoutOld = estimateActiveContextTokens([kept, compacted, recent]);

    expect(activeTokens).toBe(withoutOld);
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
    expect(prompt).toContain('## Continuation summary');
    expect(prompt).toContain('## Goal');
    expect(prompt).toContain('## Constraints');
    expect(prompt).toContain('## Decisions');
    expect(prompt).toContain('## Artifacts');
    expect(prompt).toContain('## Open work');
    expect(prompt).toContain('## Unresolved questions');
    expect(prompt).toContain('## Next steps');
    expect(COMPACTION_SYSTEM_PROMPT).not.toContain('coding session');
    expect(buildCompactionSummary(' new summary ')).toContain('new summary');
  });

  it('builds, renders, and discovers checkpoint details without losing prior ledgers', () => {
    const prefixEntries = [
      messageEntry('m1', 'user', 'old request'),
      messageEntry('m2', 'assistant', 'old answer'),
    ];
    const previous = {
      schemaVersion: 1,
      continuationSummary: 'Prior continuation.',
      goal: 'Prior goal',
      constraints: [],
      decisions: ['Prior decision'],
      artifacts: [{ label: 'Prior', vaultPath: 'A.md' }],
      openWork: [],
      unresolvedQuestions: [],
      nextSteps: [],
      source: { firstEntryId: 'old-1', lastEntryId: 'old-2', firstKeptEntryId: 'm1' },
      tokenEstimates: { contextBefore: 100, checkpoint: 10 },
    } satisfies Checkpoint;
    const current = buildCheckpoint(checkpointText, {
      prefixEntries,
      firstKeptEntryId: 'm3',
      tokensBefore: 500,
    }, previous);

    expect(current).toMatchObject({
      continuationSummary: 'Continue schema integration.',
      decisions: ['Prior decision', 'Use details'],
      artifacts: [
        { label: 'Prior', vaultPath: 'A.md' },
        { label: 'Spec', vaultPath: 'specs/005.md' },
      ],
      source: { firstEntryId: 'old-1', lastEntryId: 'm2', firstKeptEntryId: 'm3' },
      tokenEstimates: { contextBefore: 500 },
    });
    expect(renderCheckpoint(current!)).toContain('## Unresolved questions\n\nNone');

    const entry = {
      ...compactionEntry('c2', buildCompactionSummary(renderCheckpoint(current!))),
      details: { piviCheckpoint: current },
    } as PiContextCompactionEntry;
    expect(findLatestCheckpoint([compactionEntry('c1', 'legacy'), entry])).toEqual(current);
    expect(findLatestCheckpoint([compactionEntry('c1', 'legacy')])).toBeNull();
  });

  it('falls back to legacy summary data when checkpoint sections or paths are invalid', () => {
    const cutPoint = {
      prefixEntries: [
        messageEntry('m1', 'user', 'old request'),
        messageEntry('m2', 'assistant', 'old answer'),
      ],
      firstKeptEntryId: 'm3',
      tokensBefore: 500,
    };
    expect(buildCheckpoint('plain legacy summary', cutPoint, null)).toBeNull();
    expect(buildCheckpoint(
      checkpointText.replace('specs/005.md', '/Users/example/private/spec.md'),
      cutPoint,
      null,
    )).toBeNull();
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
