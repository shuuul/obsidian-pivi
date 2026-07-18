import {
  AUTO_COMPACTION_THRESHOLD_RATIO,
  buildCheckpoint,
  buildCompactionPlan,
  buildCompactionSummary,
  buildPass2Prompt,
  COMPACTION_PREFIX_RATIO,
  convertCompactionMessages,
  estimateActiveContextCategories,
  estimateActiveContextTokens,
  estimateAgentMessagesTokens,
  estimateAgentMessageTokens,
  estimateTextTokens,
  findLatestCheckpoint,
  getCompactionPrefireTokens,
  getCompactionThresholdTokens,
  parseCompactionDraft,
  PiContextTokenIndex,
  renderCheckpoint,
  sanitizeCompactionMessage,
  shouldAutoCompact,
  stripCompactCommand,
  type PiContextCompactionEntry,
} from '@pivi/pivi-agent-core/engine/pi/session/piContextCompaction';
import type { Checkpoint } from '@pivi/pivi-agent-core/session/continuationSchemas';

type PiMessageEntry = Extract<PiContextCompactionEntry, { type: 'message' }>;

function messageEntry(
  id: string,
  role: 'user' | 'assistant' | 'toolResult',
  content: unknown,
  parentId: string | null = null,
): PiMessageEntry {
  return {
    id,
    parentId,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'message',
    message: {
      role,
      content,
      ...(role === 'toolResult'
        ? { toolCallId: 'call-1', toolName: 'obsidian_read', isError: false }
        : {}),
    },
  } as unknown as PiMessageEntry;
}

function compactionEntry(
  id: string,
  summary: string,
  parentId: string | null = null,
): PiContextCompactionEntry {
  return {
    id,
    parentId,
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'compaction',
    summary,
    firstKeptEntryId: 'kept',
    tokensBefore: 1_000,
  } as unknown as PiContextCompactionEntry;
}

function checkpointJson(overrides: Record<string, unknown> = {}): string {
  return `\`\`\`pivi-checkpoint
${JSON.stringify({
    continuationSummary: 'Continue the vault migration with the verified decisions and evidence. '.repeat(12),
    goal: 'Ship vault-native compaction',
    constraints: ['Preserve durable JSONL history', 'Use vault-relative paths'],
    decisions: ['Use Pi cut-point and session primitives'],
    artifacts: [{ label: 'Spec', vaultPath: 'specs/018-vault-context-compaction-redesign.md' }],
    openWork: ['Finish runtime integration'],
    unresolvedQuestions: [],
    nextSteps: ['Run focused tests', 'Reload Obsidian'],
    ...overrides,
  })}
\`\`\``;
}

describe('piContextCompaction', () => {
  it('strips compact commands while preserving optional final-note focus', () => {
    expect(stripCompactCommand('/compact keep API decisions')).toBe('keep API decisions');
    expect(stripCompactCommand('  /compact  ')).toBeUndefined();
    expect(buildPass2Prompt('preserve wikilinks')).toContain('final NOTE₂ only');
  });

  it('uses a fixed bounded 85% trigger and ten-point prefire lead', () => {
    expect(AUTO_COMPACTION_THRESHOLD_RATIO).toBe(0.85);
    expect(COMPACTION_PREFIX_RATIO).toBe(0.95);
    expect(getCompactionThresholdTokens(1_000)).toBe(600);
    expect(getCompactionThresholdTokens(200_000, true, 16_000)).toBe(164_000);
    expect(getCompactionPrefireTokens(164_000, 200_000)).toBe(144_000);
    expect(getCompactionPrefireTokens(5_000, 128_000)).toBe(0);
  });

  it('estimates CJK, JSON, images, and Pi tool structures conservatively', () => {
    const ascii = estimateTextTokens('a'.repeat(120));
    const cjk = estimateTextTokens('知识管理系统'.repeat(20));
    const toolCall = estimateAgentMessageTokens({
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'call-1',
        name: 'obsidian_read',
        arguments: { path: '知识库/项目.md', lineStart: 1, lineEnd: 200 },
      }, { type: 'image', data: 'omitted', mimeType: 'image/png' }],
    } as never);

    expect(ascii).toBeGreaterThanOrEqual(30);
    expect(cjk).toBe(120);
    expect(toolCall).toBeGreaterThan(280);
  });

  it('updates cached entry estimates after append, replacement, and truncate', () => {
    const first = messageEntry('m1', 'user', 'a'.repeat(40));
    const second = messageEntry('m2', 'assistant', 'b'.repeat(80), 'm1');
    const index = new PiContextTokenIndex();

    index.sync([first]);
    const firstTotal = index.tokensBetween(0);
    index.sync([first, second]);
    const appendedTotal = index.tokensBetween(0);
    expect(appendedTotal).toBe(firstTotal + index.tokensAt(1));

    const replacement = messageEntry('m2', 'assistant', '知识'.repeat(100), 'm1');
    index.sync([first, replacement]);
    expect(index.tokensBetween(0)).toBeGreaterThan(appendedTotal);
    index.sync([first]);
    expect(index.tokensBetween(0)).toBe(firstTotal);
  });

  it('estimates only Pi active context around the latest compaction', () => {
    const old = messageEntry('old', 'user', 'x'.repeat(4_000));
    const kept = messageEntry('kept', 'assistant', 'y'.repeat(400), 'old');
    const compacted = {
      ...compactionEntry('c1', 'durable summary', 'kept'),
      firstKeptEntryId: 'kept',
    } as PiContextCompactionEntry;
    const recent = messageEntry('recent', 'user', 'z'.repeat(200), 'c1');
    expect(estimateActiveContextTokens([old, kept, compacted, recent]))
      .toBe(estimateActiveContextTokens([kept, compacted, recent]));
  });

  it('categorizes retained messages in legacy compacted context', () => {
    const old = messageEntry('old', 'user', 'x'.repeat(4_000));
    const kept = messageEntry('kept', 'assistant', 'y'.repeat(400), 'old');
    const compacted = {
      ...compactionEntry('c1', 'durable summary', 'kept'),
      firstKeptEntryId: 'kept',
    } as PiContextCompactionEntry;
    const recent = messageEntry('recent', 'user', 'z'.repeat(200), 'c1');

    expect(estimateActiveContextCategories([old, kept, compacted, recent])).toEqual({
      checkpoints: estimateTextTokens('durable summary'),
      recentConversation: (
        estimateAgentMessageTokens(kept.message!)
        + estimateAgentMessageTokens(recent.message!)
      ),
      toolAndAgentResults: 0,
    });
  });

  it('categorizes every entry retained across repeated compactions', () => {
    const old = messageEntry('old', 'user', 'discarded '.repeat(1_000));
    const firstKept = messageEntry('first-kept', 'assistant', 'first kept', 'old');
    const firstCompaction = {
      ...compactionEntry('c1', 'first summary', 'first-kept'),
      firstKeptEntryId: 'first-kept',
    } as PiContextCompactionEntry;
    const between = messageEntry('between', 'toolResult', 'verified tool output', 'c1');
    const secondCompaction = {
      ...compactionEntry('c2', 'second summary', 'between'),
      firstKeptEntryId: 'c1',
    } as PiContextCompactionEntry;
    const recent = messageEntry('recent', 'user', 'latest request', 'c2');

    expect(estimateActiveContextCategories([
      old,
      firstKept,
      firstCompaction,
      between,
      secondCompaction,
      recent,
    ])).toEqual({
      checkpoints: (
        estimateTextTokens('first summary')
        + estimateTextTokens('second summary')
      ),
      recentConversation: estimateAgentMessageTokens(recent.message!),
      toolAndAgentResults: estimateAgentMessageTokens(between.message!),
    });
  });

  it('categorizes only the latest full replacement after repeated compaction', () => {
    const old = messageEntry('old', 'user', 'discarded '.repeat(1_000));
    const firstBoundary = {
      id: 'b1',
      parentId: 'old',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom',
      customType: 'pivi-compaction-boundary',
      data: { schemaVersion: 1 },
    } as unknown as PiContextCompactionEntry;
    const firstCompaction = {
      ...compactionEntry('c1', 'first summary', 'b1'),
      firstKeptEntryId: 'b1',
    } as PiContextCompactionEntry;
    const between = messageEntry('between', 'assistant', 'also discarded', 'c1');
    const secondBoundary = {
      id: 'b2',
      parentId: 'between',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom',
      customType: 'pivi-compaction-boundary',
      data: { schemaVersion: 1 },
    } as unknown as PiContextCompactionEntry;
    const secondCompaction = {
      ...compactionEntry('c2', 'second summary', 'b2'),
      firstKeptEntryId: 'b2',
    } as PiContextCompactionEntry;
    const recent = messageEntry('recent', 'user', 'latest request', 'c2');

    expect(estimateActiveContextCategories([
      old,
      firstBoundary,
      firstCompaction,
      between,
      secondBoundary,
      secondCompaction,
      recent,
    ])).toEqual({
      checkpoints: estimateTextTokens('second summary'),
      recentConversation: estimateAgentMessageTokens(recent.message!),
      toolAndAgentResults: 0,
    });
  });

  it('categorizes legacy context entries projected into model messages', () => {
    const customMessage = {
      id: 'custom-message',
      parentId: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'custom_message',
      customType: 'legacy-context',
      content: 'injected legacy context',
      display: true,
    } as unknown as PiContextCompactionEntry;
    const branchSummary = {
      id: 'branch-summary',
      parentId: 'custom-message',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'branch_summary',
      fromId: 'old-branch',
      summary: 'retained branch decision',
    } as unknown as PiContextCompactionEntry;

    const categories = estimateActiveContextCategories([customMessage, branchSummary]);

    expect(categories.checkpoints).toBe(0);
    expect(categories.recentConversation).toBeGreaterThan(0);
    expect(categories.toolAndAgentResults).toBe(0);
  });

  it('uses Pi cut-point rules for a token-weighted 95/5 split', () => {
    const entries = [
      messageEntry('m1', 'user', 'old '.repeat(4_000)),
      messageEntry('m2', 'assistant', 'middle '.repeat(4_000), 'm1'),
      messageEntry('m3', 'user', 'recent request '.repeat(200), 'm2'),
      messageEntry('m4', 'assistant', [{
        type: 'toolCall',
        id: 'call-1',
        name: 'obsidian_read',
        arguments: { path: 'Projects/Pivi.md' },
      }], 'm3'),
      messageEntry('m5', 'toolResult', [{ type: 'text', text: 'verified result' }], 'm4'),
      messageEntry('m6', 'assistant', 'recent answer', 'm5'),
    ];
    const plan = buildCompactionPlan(entries);

    expect(plan).not.toBeNull();
    expect(plan!.prefixEntries.length).toBeGreaterThan(0);
    expect(plan!.tailEntries.length).toBeGreaterThan(0);
    expect((plan!.tailMessages[0] as { role?: string }).role).not.toBe('toolResult');
    expect(plan!.prefixFingerprint).toMatch(/^\d+:[0-9a-f]+$/);
  });

  it('uses the multilingual estimator before snapping a CJK split to Pi boundaries', () => {
    const entries = Array.from({ length: 20 }, (_, index) => messageEntry(
      `cjk-${index}`,
      index % 2 === 0 ? 'user' : 'assistant',
      '中文知识库内容'.repeat(200),
      index > 0 ? `cjk-${index - 1}` : undefined,
    ));
    const plan = buildCompactionPlan(entries);

    expect(plan).not.toBeNull();
    const tailTokens = estimateAgentMessagesTokens(plan!.tailMessages);
    expect(tailTokens / plan!.tokensBefore).toBeGreaterThanOrEqual(0.04);
    expect(tailTokens / plan!.tokensBefore).toBeLessThanOrEqual(0.1);
  });

  it('keeps an earlier NOTE₂ as active input on repeated compaction', () => {
    const entries = [
      compactionEntry('c1', buildCompactionSummary('previous NOTE₂')),
      messageEntry('m1', 'user', 'one '.repeat(1_000), 'c1'),
      messageEntry('m2', 'assistant', 'two '.repeat(1_000), 'm1'),
      messageEntry('m3', 'user', 'three '.repeat(1_000), 'm2'),
      messageEntry('m4', 'assistant', 'four '.repeat(1_000), 'm3'),
    ];
    const plan = buildCompactionPlan(entries);
    expect(plan?.activeEntries[0]?.type).toBe('compaction');
    expect(JSON.stringify(convertCompactionMessages(plan!.prefixMessages))).toContain('previous NOTE₂');
  });

  it('removes thinking, image payloads, and absolute device paths before Pi conversion', () => {
    const sanitized = sanitizeCompactionMessage({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hidden chain' },
        { type: 'text', text: 'Keep [[Projects/Pivi.md]]; omit /Users/example/private.md' },
        { type: 'image', data: 'secret', mimeType: 'image/png' },
      ],
    } as never);
    const converted = JSON.stringify(convertCompactionMessages([sanitized]));
    expect(converted).not.toContain('hidden chain');
    expect(converted).not.toContain('/Users/example');
    expect(converted).not.toContain('secret');
    expect(converted).toContain('[external path omitted]');
    expect(converted).toContain('[image attachment omitted');
    expect(converted).toContain('[[Projects/Pivi.md]]');
  });

  it('normalizes complete structured drafts and rejects incomplete or unsafe results', () => {
    expect(parseCompactionDraft(checkpointJson())).toMatchObject({
      goal: 'Ship vault-native compaction',
      artifacts: [{ label: 'Spec', vaultPath: 'specs/018-vault-context-compaction-redesign.md' }],
    });
    const concise = {
      continuationSummary: 'Continue the verified migration.',
      goal: null,
      constraints: [],
      decisions: [],
      artifacts: [],
      openWork: [],
      unresolvedQuestions: [],
      nextSteps: [],
    };
    expect(parseCompactionDraft(JSON.stringify(concise))).toEqual(concise);
    expect(parseCompactionDraft(`\`\`\`json\n${JSON.stringify(concise)}\n\`\`\``))
      .toEqual(concise);
    expect(parseCompactionDraft(checkpointJson({
      artifacts: [{ label: 'Private', vaultPath: '../private.md' }],
    }))).toBeNull();
    expect(parseCompactionDraft(checkpointJson({
      continuationSummary: 'Device path: /Users/example/private.md '.repeat(20),
    }))).toBeNull();
    expect(parseCompactionDraft(checkpointJson({
      continuationSummary: 'Device path: /etc/pivi/config.json '.repeat(20),
    }))).toBeNull();
    expect(parseCompactionDraft('```pivi-checkpoint\n{"continuationSummary":"short"}\n```'))
      .toBeNull();
    expect(parseCompactionDraft(`Commentary\n${JSON.stringify(concise)}`)).toBeNull();
  });

  it('builds and merges Checkpoint v1 ledgers for NOTE₂', () => {
    const plan = buildCompactionPlan([
      messageEntry('m1', 'user', 'old '.repeat(2_000)),
      messageEntry('m2', 'assistant', 'answer '.repeat(2_000), 'm1'),
      messageEntry('m3', 'user', 'recent '.repeat(100), 'm2'),
      messageEntry('m4', 'assistant', 'done '.repeat(100), 'm3'),
    ])!;
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
      source: { firstEntryId: 'old-1', lastEntryId: 'old-2', firstKeptEntryId: 'old-boundary' },
      tokenEstimates: { contextBefore: 100, checkpoint: 10 },
    } satisfies Checkpoint;
    const draft = parseCompactionDraft(checkpointJson())!;
    const current = buildCheckpoint(draft, plan, previous);

    expect(current).toMatchObject({
      decisions: ['Prior decision', 'Use Pi cut-point and session primitives'],
      artifacts: [
        { label: 'Prior', vaultPath: 'A.md' },
        { label: 'Spec', vaultPath: 'specs/018-vault-context-compaction-redesign.md' },
      ],
      source: { firstEntryId: 'old-1', firstKeptEntryId: 'pending-compaction-boundary' },
    });
    expect(renderCheckpoint(current!)).toContain('## Unresolved questions\n\nNone');
    const persisted = {
      ...compactionEntry('c2', buildCompactionSummary(renderCheckpoint(current!))),
      details: { piviCheckpoint: current },
    } as PiContextCompactionEntry;
    expect(findLatestCheckpoint([persisted])).toEqual(current);
    expect(buildCheckpoint(draft, plan, {
      ...previous,
      decisions: ['/etc/pivi/secret.json'],
    })).toBeNull();
  });

  it('keeps automatic decisions fixed, fingerprint-scoped, and provider-pressure aware', () => {
    const providerUsage = {
      contextTokens: 900,
      contextWindow: 1_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 900,
      percentage: 90,
      contextTokensIsAuthoritative: true,
    };
    expect(shouldAutoCompact({
      compactionInFlight: false,
      failedFingerprint: null,
      providerUsage,
      sessionFingerprint: 'current',
      sessionLeafId: 'leaf-1',
      storedConversationTokens: 100,
    })).toBe(true);
    expect(shouldAutoCompact({
      compactionInFlight: false,
      failedFingerprint: 'current',
      providerUsage,
      sessionFingerprint: 'current',
      sessionLeafId: 'leaf-1',
      storedConversationTokens: 1_000,
    })).toBe(false);
  });
});
