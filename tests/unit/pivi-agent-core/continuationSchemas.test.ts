import {
  AGENT_REPORT_BLOCK_LANGUAGE,
  extractAgentReportFromText,
  mergeCheckpoints,
  parseAgentReport,
  parseCheckpoint,
  stripAgentReportBlocksFromText,
  type AgentReport,
  type Checkpoint,
} from '@pivi/pivi-agent-core/session/continuationSchemas';

import { createAgentReportBlock } from '../../helpers/agentReport';

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    schemaVersion: 1,
    continuationSummary: 'Continue implementation.',
    goal: 'Ship the schema',
    constraints: ['Keep compatibility'],
    decisions: ['Use additive storage'],
    artifacts: [{ label: 'Spec', vaultPath: 'specs/005.md' }],
    openWork: ['Wire the writer'],
    unresolvedQuestions: [],
    nextSteps: ['Run tests'],
    source: {
      firstEntryId: 'message-1',
      lastEntryId: 'message-4',
      firstKeptEntryId: 'message-5',
    },
    tokenEstimates: { contextBefore: 1200, checkpoint: 80 },
    ...overrides,
  };
}

describe('continuation schemas', () => {
  it('parses and normalizes a versioned checkpoint', () => {
    expect(parseCheckpoint({
      ...checkpoint(),
      decisions: ['Use additive storage', 'Use additive storage', '  Test old files  '],
    })).toMatchObject({
      decisions: ['Use additive storage', 'Test old files'],
      source: { firstKeptEntryId: 'message-5' },
    });
  });

  it.each([
    { ...checkpoint(), schemaVersion: 2 },
    { ...checkpoint(), continuationSummary: '' },
    { ...checkpoint(), tokenEstimates: { contextBefore: -1, checkpoint: 2 } },
    { ...checkpoint(), artifacts: [{ label: 'private', vaultPath: '/Users/example/private' }] },
    { ...checkpoint(), artifacts: [{ label: 'private', vaultPath: 'C:\\Users\\example' }] },
    { ...checkpoint(), artifacts: [{ label: 'private', vaultPath: '\\\\server\\share' }] },
  ])('downgrades malformed or device-local checkpoint data to legacy text', (value) => {
    expect(parseCheckpoint(value)).toBeNull();
  });

  it('merges durable checkpoint ledgers and keeps latest continuation state', () => {
    const merged = mergeCheckpoints(checkpoint({
      decisions: ['Prior decision'],
      artifacts: [{ label: 'Prior', vaultPath: 'A.md' }],
      openWork: ['Old work'],
      source: { firstEntryId: 'message-1', lastEntryId: 'message-4', firstKeptEntryId: 'message-5' },
    }), checkpoint({
      continuationSummary: 'Latest continuation.',
      decisions: ['Prior decision', 'New decision'],
      artifacts: [{ label: 'Prior', vaultPath: 'A.md' }, { label: 'New', vaultPath: 'B.md' }],
      openWork: ['Latest work'],
      source: { firstEntryId: 'compaction-1', lastEntryId: 'message-8', firstKeptEntryId: 'message-9' },
    }));

    expect(merged.continuationSummary).toBe('Latest continuation.');
    expect(merged.decisions).toEqual(['Prior decision', 'New decision']);
    expect(merged.artifacts).toEqual([
      { label: 'Prior', vaultPath: 'A.md' },
      { label: 'New', vaultPath: 'B.md' },
    ]);
    expect(merged.openWork).toEqual(['Latest work']);
    expect(merged.source.firstEntryId).toBe('message-1');
  });

  it.each(['completed', 'failed', 'cancelled', 'orphaned'] as const)(
    'accepts a partial %s Agent report',
    (outcome) => {
      expect(parseAgentReport({ schemaVersion: 1, objective: 'Audit files', outcome }))
        .toEqual({ schemaVersion: 1, objective: 'Audit files', outcome });
    },
  );

  it.each([
    { schemaVersion: 1, outcome: 'completed' },
    { schemaVersion: 1, objective: 'Audit', outcome: 'unknown' },
    { schemaVersion: 2, objective: 'Audit', outcome: 'failed' },
    { schemaVersion: 1, objective: 'Audit', outcome: 'failed', findings: 'not-an-array' },
    { schemaVersion: 1, objective: 'Audit', outcome: 'failed', artifacts: [{ label: 'x', vaultPath: 'file:///private/x' }] },
  ])('rejects malformed Agent reports without throwing', (value) => {
    expect(parseAgentReport(value)).toBeNull();
  });

  it('extracts the last valid fenced report and ignores malformed blocks', () => {
    const report: AgentReport = {
      schemaVersion: 1,
      objective: 'Audit files',
      outcome: 'completed',
      findings: ['One finding'],
    };
    const terminal = [
      'Narrative remains available.',
      `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}`,
      '{invalid json}',
      '```',
      createAgentReportBlock(report),
    ].join('\n');
    expect(extractAgentReportFromText(terminal)).toEqual(report);
    expect(extractAgentReportFromText('plain terminal result')).toBeNull();
  });

  it('strips every internal report fence from visible terminal text', () => {
    const terminal = [
      'Narrative remains available.',
      `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}`,
      '{invalid json}',
      '```',
      '',
      'Second paragraph.',
      `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}`,
      JSON.stringify({ schemaVersion: 2, objective: 'Unknown', outcome: 'completed' }),
      '```',
    ].join('\n');
    expect(stripAgentReportBlocksFromText(terminal)).toBe([
      'Narrative remains available.',
      '',
      'Second paragraph.',
    ].join('\n'));
  });

  it('removes an unclosed internal report fence through the end of terminal text', () => {
    expect(stripAgentReportBlocksFromText([
      'Visible result.',
      `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}`,
      '{"schemaVersion":1',
    ].join('\n'))).toBe('Visible result.');
  });
});
