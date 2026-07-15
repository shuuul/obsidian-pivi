export const CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const AGENT_REPORT_SCHEMA_VERSION = 1 as const;

export interface ArtifactReference {
  label: string;
  /** Vault-relative path. Absolute device paths are rejected at parse/write boundaries. */
  vaultPath?: string;
}

export interface CheckpointSourceBounds {
  firstEntryId: string;
  lastEntryId: string;
  firstKeptEntryId: string;
}

export interface CheckpointTokenEstimates {
  contextBefore: number;
  checkpoint: number;
}

export interface Checkpoint {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  continuationSummary: string;
  goal: string | null;
  constraints: string[];
  decisions: string[];
  artifacts: ArtifactReference[];
  openWork: string[];
  unresolvedQuestions: string[];
  nextSteps: string[];
  source: CheckpointSourceBounds;
  tokenEstimates: CheckpointTokenEstimates;
}

export interface PiviCompactionDetails {
  piviCheckpoint: Checkpoint;
}

export type AgentReportOutcome =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'orphaned';

export interface AgentReport {
  schemaVersion: typeof AGENT_REPORT_SCHEMA_VERSION;
  objective: string;
  outcome: AgentReportOutcome;
  summary?: string;
  findings?: string[];
  decisions?: string[];
  artifacts?: ArtifactReference[];
  openQuestions?: string[];
}

export const AGENT_REPORT_BLOCK_LANGUAGE = 'pivi-agent-report';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = nonEmptyString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Cross-platform absolute-path check for synced structured session data. */
export function isAbsoluteDevicePath(value: string): boolean {
  const path = value.trim();
  return path.startsWith('/')
    || path.startsWith('\\\\')
    || /^[A-Za-z]:[\\/]/.test(path)
    || /^file:\/\//i.test(path);
}

function parseArtifacts(value: unknown): ArtifactReference[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: ArtifactReference[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const label = nonEmptyString(item.label);
    if (!label) {
      return null;
    }
    const vaultPath = item.vaultPath === undefined
      ? undefined
      : nonEmptyString(item.vaultPath);
    if (item.vaultPath !== undefined && !vaultPath) {
      return null;
    }
    if (vaultPath && isAbsoluteDevicePath(vaultPath)) {
      return null;
    }
    const key = `${label}\u0000${vaultPath ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(vaultPath ? { label, vaultPath } : { label });
  }
  return result;
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Parse persisted checkpoint data without throwing or upgrading unknown versions. */
export function parseCheckpoint(value: unknown): Checkpoint | null {
  if (!isRecord(value) || value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    return null;
  }
  const continuationSummary = nonEmptyString(value.continuationSummary);
  const goal = value.goal === null ? null : nonEmptyString(value.goal);
  const constraints = uniqueStrings(value.constraints);
  const decisions = uniqueStrings(value.decisions);
  const artifacts = parseArtifacts(value.artifacts);
  const openWork = uniqueStrings(value.openWork);
  const unresolvedQuestions = uniqueStrings(value.unresolvedQuestions);
  const nextSteps = uniqueStrings(value.nextSteps);
  if (!continuationSummary || (value.goal !== null && !goal)
    || !constraints || !decisions || !artifacts || !openWork
    || !unresolvedQuestions || !nextSteps
    || !isRecord(value.source) || !isRecord(value.tokenEstimates)) {
    return null;
  }
  const firstEntryId = nonEmptyString(value.source.firstEntryId);
  const lastEntryId = nonEmptyString(value.source.lastEntryId);
  const firstKeptEntryId = nonEmptyString(value.source.firstKeptEntryId);
  const contextBefore = nonNegativeFiniteNumber(value.tokenEstimates.contextBefore);
  const checkpoint = nonNegativeFiniteNumber(value.tokenEstimates.checkpoint);
  if (!firstEntryId || !lastEntryId || !firstKeptEntryId
    || contextBefore === null || checkpoint === null) {
    return null;
  }
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    continuationSummary,
    goal,
    constraints,
    decisions,
    artifacts,
    openWork,
    unresolvedQuestions,
    nextSteps,
    source: { firstEntryId, lastEntryId, firstKeptEntryId },
    tokenEstimates: { contextBefore, checkpoint },
  };
}

export function parsePiviCompactionDetails(value: unknown): PiviCompactionDetails | null {
  if (!isRecord(value)) {
    return null;
  }
  const piviCheckpoint = parseCheckpoint(value.piviCheckpoint);
  return piviCheckpoint ? { piviCheckpoint } : null;
}

function mergeUnique<T>(
  previous: readonly T[],
  current: readonly T[],
  key: (value: T) => string,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const item of [...previous, ...current]) {
    const itemKey = key(item);
    if (!seen.has(itemKey)) {
      seen.add(itemKey);
      result.push(item);
    }
  }
  return result;
}

/** Merge durable ledger fields while the latest checkpoint owns live continuation state. */
export function mergeCheckpoints(previous: Checkpoint | null, current: Checkpoint): Checkpoint {
  if (!previous) {
    return current;
  }
  return {
    ...current,
    decisions: mergeUnique(previous.decisions, current.decisions, (value) => value),
    artifacts: mergeUnique(
      previous.artifacts,
      current.artifacts,
      (value) => `${value.label}\u0000${value.vaultPath ?? ''}`,
    ),
    source: {
      ...current.source,
      firstEntryId: previous.source.firstEntryId,
    },
  };
}

const AGENT_REPORT_OUTCOMES = new Set<AgentReportOutcome>([
  'completed',
  'failed',
  'cancelled',
  'orphaned',
]);

/** Parse a partial or failed report; only objective and outcome are required. */
export function parseAgentReport(value: unknown): AgentReport | null {
  if (!isRecord(value)
    || value.schemaVersion !== AGENT_REPORT_SCHEMA_VERSION) {
    return null;
  }
  const objective = nonEmptyString(value.objective);
  const outcome = nonEmptyString(value.outcome) as AgentReportOutcome | null;
  if (!objective || !outcome || !AGENT_REPORT_OUTCOMES.has(outcome)) {
    return null;
  }
  const report: AgentReport = {
    schemaVersion: AGENT_REPORT_SCHEMA_VERSION,
    objective,
    outcome,
  };
  const summary = value.summary === undefined ? undefined : nonEmptyString(value.summary);
  if (value.summary !== undefined && !summary) {
    return null;
  }
  if (summary) report.summary = summary;
  for (const [field, source] of [
    ['findings', value.findings],
    ['decisions', value.decisions],
    ['openQuestions', value.openQuestions],
  ] as const) {
    if (source === undefined) continue;
    const parsed = uniqueStrings(source);
    if (!parsed) return null;
    report[field] = parsed;
  }
  if (value.artifacts !== undefined) {
    const artifacts = parseArtifacts(value.artifacts);
    if (!artifacts) return null;
    report.artifacts = artifacts;
  }
  return report;
}

/** Extract the last valid structured report block from terminal text. */
export function extractAgentReportFromText(text: string): AgentReport | null {
  const pattern = new RegExp(
    '(?:^|\\n)```' + AGENT_REPORT_BLOCK_LANGUAGE
      + '\\s*\\n([\\s\\S]*?)\\n```(?=\\n|$)',
    'gi',
  );
  let report: AgentReport | null = null;
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed = parseAgentReport(JSON.parse(match[1] ?? ''));
      if (parsed) report = parsed;
    } catch {
      // A malformed block is compatibility text, not a turn failure.
    }
  }
  return report;
}

export function formatAgentReportBlock(report: AgentReport): string {
  return `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}\n${JSON.stringify(report, null, 2)}\n\`\`\``;
}

function formatReportList(label: string, values: readonly string[] | undefined): string[] {
  return values && values.length > 0
    ? [label, ...values.map((value) => `- ${value}`)]
    : [];
}

/** Compact, deterministic text for the parent model; raw terminal text stays in details. */
export function formatAgentReportForParent(report: AgentReport): string {
  const artifacts = report.artifacts?.map((artifact) => (
    `${artifact.label}${artifact.vaultPath ? ` (${artifact.vaultPath})` : ''}`
  ));
  return [
    `Agent report objective: ${report.objective}`,
    `Outcome: ${report.outcome}`,
    report.summary ? `Summary: ${report.summary}` : '',
    ...formatReportList('Findings:', report.findings),
    ...formatReportList('Decisions:', report.decisions),
    ...formatReportList('Artifacts:', artifacts),
    ...formatReportList('Open questions:', report.openQuestions),
  ].filter(Boolean).join('\n');
}

export function withAgentReportOutcome(
  report: AgentReport,
  outcome: AgentReportOutcome,
): AgentReport {
  return { ...report, outcome };
}
