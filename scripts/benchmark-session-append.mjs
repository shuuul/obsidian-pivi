import { SessionManager } from '@earendil-works/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  ensureSessionJsonlIndex,
} from '../packages/pivi-agent-core/src/engine/pi/session/sessionJsonlIndex.ts';
import {
  SessionTreeStore,
} from '../packages/pivi-agent-core/src/engine/pi/session/sessionTreeStore.ts';

const FIXTURE_NAME = 'perf-002-5k-messages.jsonl';
const TRIALS = 5;
const APPENDS_PER_TRIAL = 20;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value) {
  return Number(value.toFixed(3));
}

function copyFixture(vaultPath, root, name) {
  const sessions = path.join(root, '.pivi', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const target = path.join(sessions, name);
  cpSync(path.join(vaultPath, '.pivi', 'sessions', FIXTURE_NAME), target);
  return target;
}

function benchmarkRewrite(vaultPath, trial) {
  const root = mkdtempSync(path.join(tmpdir(), `pivi-append-rewrite-${trial}-`));
  try {
    const sessionFile = copyFixture(vaultPath, root, 'rewrite.jsonl');
    const manager = SessionManager.open(sessionFile, path.dirname(sessionFile), root);
    const bytesBefore = statSync(sessionFile).size;
    const startedAt = performance.now();
    for (let index = 0; index < APPENDS_PER_TRIAL; index++) {
      manager.appendMessage({
        role: 'user',
        content: `Append benchmark ${trial}-${index}`,
        timestamp: 1_700_000_000_000 + index,
      });
      manager._rewriteFile();
      manager.flushed = true;
    }
    const totalMs = performance.now() - startedAt;
    return {
      mode: 'rewrite',
      totalMs,
      perAppendMs: totalMs / APPENDS_PER_TRIAL,
      bytesBefore,
      bytesAfter: statSync(sessionFile).size,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function benchmarkIndexedAppend(vaultPath, trial) {
  const root = mkdtempSync(path.join(tmpdir(), `pivi-append-indexed-${trial}-`));
  try {
    const sessionFile = copyFixture(vaultPath, root, 'indexed.jsonl');
    ensureSessionJsonlIndex(sessionFile);
    const relativeSessionFile = '.pivi/sessions/indexed.jsonl';
    const store = SessionTreeStore.open(root, relativeSessionFile);
    const bytesBefore = statSync(sessionFile).size;
    const startedAt = performance.now();
    for (let index = 0; index < APPENDS_PER_TRIAL; index++) {
      store.appendUserMessage(`Append benchmark ${trial}-${index}`);
    }
    const totalMs = performance.now() - startedAt;
    return {
      mode: 'indexed-append',
      totalMs,
      perAppendMs: totalMs / APPENDS_PER_TRIAL,
      bytesBefore,
      bytesAfter: statSync(sessionFile).size,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const vaultPath = process.argv[2];
  if (!vaultPath) {
    throw new Error(
      'Usage: node --import tsx scripts/benchmark-session-append.mjs <vault>',
    );
  }
  const fixture = path.join(vaultPath, '.pivi', 'sessions', FIXTURE_NAME);
  const fixtureLines = readFileSync(fixture, 'utf8').trimEnd().split('\n').length;
  const rewrite = Array.from({ length: TRIALS }, (_, trial) => benchmarkRewrite(vaultPath, trial));
  const indexedAppend = Array.from(
    { length: TRIALS },
    (_, trial) => benchmarkIndexedAppend(vaultPath, trial),
  );
  const rewriteMedianMs = median(rewrite.map(result => result.perAppendMs));
  const indexedAppendMedianMs = median(indexedAppend.map(result => result.perAppendMs));
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  process.stdout.write(`${JSON.stringify({
    schema: 'pivi-session-append-benchmark-v1',
    commit,
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    fixture: {
      name: FIXTURE_NAME,
      lines: fixtureLines,
      bytes: statSync(fixture).size,
    },
    trials: TRIALS,
    appendsPerTrial: APPENDS_PER_TRIAL,
    rewritePerAppendMs: rewrite.map(result => round(result.perAppendMs)),
    indexedAppendPerAppendMs: indexedAppend.map(result => round(result.perAppendMs)),
    median: {
      rewritePerAppendMs: round(rewriteMedianMs),
      indexedAppendPerAppendMs: round(indexedAppendMedianMs),
      speedup: round(rewriteMedianMs / indexedAppendMedianMs),
    },
  }, null, 2)}\n`);
}

main();
