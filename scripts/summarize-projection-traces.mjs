#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';

const TRACE_SCHEMA = 'pivi-chat-perf-v2';

function fail(message) {
  throw new Error(message);
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarizeValues(values) {
  if (values.length === 0) return null;
  return {
    count: values.length,
    min: Math.min(...values),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function validateValues(path, metrics) {
  for (const [name, values] of Object.entries(metrics)) {
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        fail(`Trace has invalid ${name} value at ${path}: ${String(value)}`);
      }
    }
  }
}

function metricValues(events) {
  return {
    dispatchValidationMs: events
      .filter(event => event.type === 'projection.dispatch' && event.accepted)
      .map(event => event.validationDurationMs),
    dispatchTotalMs: events
      .filter(event => event.type === 'projection.dispatch' && event.accepted)
      .map(event => event.totalDurationMs),
    snapshotMs: events
      .filter(event => event.type === 'projection.snapshot')
      .map(event => event.durationMs),
    entityCommitMs: events
      .filter(event => event.type === 'projection.entity-commit')
      .map(event => event.durationMs),
    projectionCommitMs: events
      .filter(event => event.type === 'projection.commit')
      .map(event => event.commitDurationMs),
    eventToPaintMs: events
      .filter(event => event.type === 'projection.paint' && event.eventToPaintMs !== null)
      .map(event => event.eventToPaintMs),
    markdownRenderMs: events
      .filter(event => event.type === 'markdown.render')
      .map(event => event.durationMs),
  };
}

function summarizeTrace(path) {
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  if (trace.schema !== TRACE_SCHEMA) {
    fail(`Expected ${TRACE_SCHEMA} trace at ${path}, received ${String(trace.schema)}`);
  }
  if (!Array.isArray(trace.events)) fail(`Trace has no events array: ${path}`);
  const snapshots = trace.events.filter(event => event.type === 'projection.snapshot');
  const metrics = metricValues(trace.events);
  const allocationValues = {
    visitedEntities: snapshots.map(event => event.visitedEntities),
    clonedEntities: snapshots.map(event => event.clonedEntities),
  };
  validateValues(path, metrics);
  validateValues(path, allocationValues);
  if (snapshots.some(event => event.snapshotCalls !== 1)) {
    fail(`Trace has invalid snapshotCalls value at ${path}`);
  }
  return {
    path,
    scenario: trace.scenario,
    environment: trace.environment,
    projectionWorkload: trace.projectionWorkload ?? null,
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, values]) => [name, summarizeValues(values)]),
    ),
    allocationProxies: {
      snapshotCalls: snapshots.reduce((total, event) => total + event.snapshotCalls, 0),
      visitedEntities: summarizeValues(allocationValues.visitedEntities),
      clonedEntities: summarizeValues(allocationValues.clonedEntities),
    },
  };
}

function summarizeScenario(runs) {
  const metricNames = Object.keys(runs[0].summary.metrics);
  const snapshots = runs.flatMap(run => (
    run.traceEvents.filter(event => event.type === 'projection.snapshot')
  ));
  return {
    runs: runs.length,
    aggregate: Object.fromEntries(metricNames.map((name) => {
      const values = runs.flatMap(run => metricValues(run.traceEvents)[name]);
      return [name, summarizeValues(values)];
    })),
    runMedianRanges: Object.fromEntries(metricNames.map((name) => {
      const medians = runs
        .map(run => run.summary.metrics[name]?.median)
        .filter(value => value !== null && value !== undefined);
      return [name, summarizeValues(medians)];
    })),
    allocationProxies: {
      snapshotCallsPerRun: summarizeValues(
        runs.map(run => run.summary.allocationProxies.snapshotCalls),
      ),
      visitedEntities: summarizeValues(snapshots.map(event => event.visitedEntities)),
      clonedEntities: summarizeValues(snapshots.map(event => event.clonedEntities)),
      runMedianRanges: {
        visitedEntities: summarizeValues(runs
          .map(run => run.summary.allocationProxies.visitedEntities?.median)
          .filter(value => value !== null && value !== undefined)),
        clonedEntities: summarizeValues(runs
          .map(run => run.summary.allocationProxies.clonedEntities?.median)
          .filter(value => value !== null && value !== undefined)),
      },
    },
  };
}

const paths = process.argv.slice(2).map(path => resolve(path));
if (paths.length === 0) {
  fail('Usage: node scripts/summarize-projection-traces.mjs <trace.json> [...]');
}

const loaded = paths.map(path => {
  const trace = JSON.parse(readFileSync(path, 'utf8'));
  const summary = summarizeTrace(path);
  return { summary, traceEvents: trace.events };
});
const byScenario = new Map();
for (const run of loaded) {
  const scenarioRuns = byScenario.get(run.summary.scenario) ?? [];
  scenarioRuns.push(run);
  byScenario.set(run.summary.scenario, scenarioRuns);
}

process.stdout.write(`${JSON.stringify({
  schema: 'pivi-projection-perf-summary-v1',
  traces: loaded.map(run => run.summary),
  scenarios: Object.fromEntries(
    [...byScenario].map(([scenario, runs]) => [scenario, summarizeScenario(runs)]),
  ),
}, null, 2)}\n`);
