/** Compaction draft parsing, device-path redaction, and checkpoint construction/rendering. */

import { estimateTextTokens } from '@pivi/agent/prompt';
import {
  type Checkpoint,
  CHECKPOINT_SCHEMA_VERSION,
  mergeCheckpoints,
  parsePiviCompactionDetails,
} from '@pivi/agent/session/continuationSchemas';

import type {
  CompactionDraft,
  CompactionDraftParseResult,
  PiContextCompactionEntry,
  PiContextCompactionPlan,
} from './piContextCompaction';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCompactionEntry(
  entry: PiContextCompactionEntry,
): entry is PiContextCompactionEntry & { type: 'compaction'; summary: string } {
  return entry.type === 'compaction'
    && typeof (entry as unknown as { summary?: unknown }).summary === 'string';
}

// Windows drive letters need a non-letter boundary so URL schemes like
// `https://` (`s:/`) and `http://` (`p:/`) are not treated as device paths.
const DEVICE_PATH_IN_TEXT = /(?:file:\/\/\/|(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|private|tmp|var|Volumes|etc|opt|usr|bin|sbin|root|dev|mnt|Library|Applications|System|Windows)\/)\S*/gi;

// Extension-bearing absolute paths only. Slash-separated prose such as
// `已完成/无需更新` or `/hover/focus/disabled` must not fail compaction.
const GENERIC_ABSOLUTE_PATH_IN_TEXT = /(?<![A-Za-z0-9_.:/-])\/(?:(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+)\.[A-Za-z0-9]+/g;

export function redactDevicePaths(text: string): string {
  return text
    .replace(DEVICE_PATH_IN_TEXT, '[external path omitted]')
    .replace(GENERIC_ABSOLUTE_PATH_IN_TEXT, '[external path omitted]');
}

function containsDevicePath(value: unknown): boolean {
  if (typeof value === 'string') {
    DEVICE_PATH_IN_TEXT.lastIndex = 0;
    GENERIC_ABSOLUTE_PATH_IN_TEXT.lastIndex = 0;
    return DEVICE_PATH_IN_TEXT.test(value)
      || GENERIC_ABSOLUTE_PATH_IN_TEXT.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsDevicePath);
  }
  return isRecord(value) && Object.values(value).some(containsDevicePath);
}

function extractCheckpointJson(text: string): {
  ok: true;
  value: unknown;
} | {
  ok: false;
  reason: 'invalid-json' | 'missing-json';
} {
  const pattern = /(?:^|\n)```pivi-checkpoint\s*\n([\s\S]*?)\n```(?=\n|$)/gi;
  let candidate: { ok: true; value: unknown } | { ok: false; reason: 'invalid-json' } | null = null;
  for (const match of text.matchAll(pattern)) {
    try {
      candidate = { ok: true, value: JSON.parse(match[1] ?? '') };
    } catch {
      candidate = { ok: false, reason: 'invalid-json' };
    }
  }
  if (candidate) {
    return candidate;
  }

  const trimmed = text.trim();
  const wholeJsonFence = trimmed.match(/^```json\s*\n([\s\S]*?)\n```$/i);
  const json = wholeJsonFence?.[1] ?? (
    trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : null
  );
  if (!json) {
    return { ok: false, reason: 'missing-json' };
  }
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}

function invalidCompactionDraftFields(value: Record<string, unknown>): string[] {
  const invalidFields: string[] = [];
  if (
    typeof value.continuationSummary !== 'string'
    || !value.continuationSummary.trim()
  ) {
    invalidFields.push('continuationSummary');
  }
  if (
    value.goal !== null
    && (typeof value.goal !== 'string' || !value.goal.trim())
  ) {
    invalidFields.push('goal');
  }
  for (const field of [
    'constraints',
    'decisions',
    'artifacts',
    'openWork',
    'unresolvedQuestions',
    'nextSteps',
  ] as const) {
    if (!Array.isArray(value[field])) {
      invalidFields.push(field);
    }
  }
  if (
    Array.isArray(value.artifacts)
    && value.artifacts.some((artifact) => {
      if (!isRecord(artifact)) {
        return true;
      }
      if (typeof artifact.label !== 'string' || !artifact.label.trim()) {
        return true;
      }
      if (artifact.vaultPath === undefined) {
        return false;
      }
      if (typeof artifact.vaultPath !== 'string' || !artifact.vaultPath.trim()) {
        return true;
      }
      const pathSegments = artifact.vaultPath.replace(/\\/g, '/').split('/');
      return pathSegments.includes('..');
    })
    && !invalidFields.includes('artifacts')
  ) {
    invalidFields.push('artifacts');
  }
  if (
    value.schemaVersion !== undefined
    && value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
  ) {
    invalidFields.push('schemaVersion');
  }
  return invalidFields;
}

export function parseCompactionDraftResult(text: string): CompactionDraftParseResult {
  const extracted = extractCheckpointJson(text);
  if (!extracted.ok) {
    return extracted;
  }
  const value = extracted.value;
  if (!isRecord(value) || containsDevicePath(value)) {
    return {
      ok: false,
      reason: containsDevicePath(value) ? 'device-path' : 'invalid-fields',
      ...(!isRecord(value) ? { invalidFields: ['root'] } : {}),
    };
  }
  const invalidFields = invalidCompactionDraftFields(value);
  if (invalidFields.length > 0) {
    return { invalidFields, ok: false, reason: 'invalid-fields' };
  }
  const checkpoint = parsePiviCompactionDetails({
    piviCheckpoint: {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      ...value,
      source: {
        firstEntryId: 'draft-first',
        lastEntryId: 'draft-last',
        firstKeptEntryId: 'draft-boundary',
      },
      tokenEstimates: {
        contextBefore: 0,
        checkpoint: 0,
      },
    },
  })?.piviCheckpoint;
  if (!checkpoint) {
    return { ok: false, reason: 'invalid-fields' };
  }
  const draft: CompactionDraft = {
    continuationSummary: checkpoint.continuationSummary,
    goal: checkpoint.goal,
    constraints: checkpoint.constraints,
    decisions: checkpoint.decisions,
    artifacts: checkpoint.artifacts,
    openWork: checkpoint.openWork,
    unresolvedQuestions: checkpoint.unresolvedQuestions,
    nextSteps: checkpoint.nextSteps,
  };
  return { draft, ok: true };
}

export function parseCompactionDraft(text: string): CompactionDraft | null {
  const result = parseCompactionDraftResult(text);
  return result.ok ? result.draft : null;
}

export function renderCompactionDraft(draft: CompactionDraft): string {
  return renderCheckpoint({
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    ...draft,
    source: {
      firstEntryId: 'draft-first',
      lastEntryId: 'draft-last',
      firstKeptEntryId: 'draft-boundary',
    },
    tokenEstimates: {
      contextBefore: 0,
      checkpoint: 0,
    },
  });
}

export function findLatestCheckpoint(entries: PiContextCompactionEntry[]): Checkpoint | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry || !isCompactionEntry(entry)) {
      continue;
    }
    const details = parsePiviCompactionDetails(
      (entry as unknown as { details?: unknown }).details,
    );
    if (details) {
      return details.piviCheckpoint;
    }
  }
  return null;
}

export function buildCheckpoint(
  draft: CompactionDraft,
  plan: PiContextCompactionPlan,
  previous: Checkpoint | null,
  firstKeptEntryId = 'pending-compaction-boundary',
): Checkpoint | null {
  const first = plan.activeEntries[0];
  const last = plan.activeEntries.at(-1);
  if (!first || !last) {
    return null;
  }
  const checkpoint = parsePiviCompactionDetails({
    piviCheckpoint: {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      ...draft,
      source: {
        firstEntryId: first.id,
        lastEntryId: last.id,
        firstKeptEntryId,
      },
      tokenEstimates: {
        contextBefore: plan.tokensBefore,
        checkpoint: estimateTextTokens(renderCompactionDraft(draft)),
      },
    },
  })?.piviCheckpoint ?? null;
  if (!checkpoint) {
    return null;
  }
  const merged = mergeCheckpoints(previous, checkpoint);
  if (containsDevicePath(merged)) {
    return null;
  }
  return {
    ...merged,
    tokenEstimates: {
      ...merged.tokenEstimates,
      checkpoint: estimateTextTokens(renderCheckpoint(merged)),
    },
  };
}

export function renderList(values: readonly string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : 'None';
}

export function renderCheckpoint(checkpoint: Checkpoint): string {
  const artifacts = checkpoint.artifacts.length > 0
    ? checkpoint.artifacts.map((artifact) => (
      `- ${artifact.label}${artifact.vaultPath ? ` :: ${artifact.vaultPath}` : ''}`
    )).join('\n')
    : 'None';
  return [
    '## Continuation summary',
    checkpoint.continuationSummary,
    '## Goal',
    checkpoint.goal ?? 'None',
    '## Constraints',
    renderList(checkpoint.constraints),
    '## Decisions',
    renderList(checkpoint.decisions),
    '## Artifacts',
    artifacts,
    '## Open work',
    renderList(checkpoint.openWork),
    '## Unresolved questions',
    renderList(checkpoint.unresolvedQuestions),
    '## Next steps',
    renderList(checkpoint.nextSteps),
  ].join('\n\n');
}
