import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const OVERSIZED_TOOL_RESULT_BYTES = 100_000;
const OVERSIZED_SESSION_BYTES = 10 * 1024 * 1024;
const MESSAGE_UI_OVERLAY_LIMIT = 20;
const BASH_POLICY_ERROR = /^(?:Bash command (?:is required|must |not in allowlist))/;

function usage() {
  return 'Usage: node scripts/audit-sessions.mjs <vault-or-sessions-dir> [--json]';
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolveSessionsDirectory(inputPath) {
  const candidate = resolve(inputPath);
  const vaultSessions = join(candidate, '.pivi', 'sessions');
  if (isDirectory(vaultSessions)) {
    return vaultSessions;
  }
  if (isDirectory(candidate)) {
    return candidate;
  }
  throw new Error(`Sessions directory is not readable: ${inputPath}`);
}

function collectJsonlFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }
  return files.sort();
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function getToolResultText(message) {
  if (!Array.isArray(message.content)) {
    return typeof message.content === 'string' ? message.content : '';
  }
  return message.content
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('\n');
}

function toolRows(calls, results, errors, repeatedExactCalls) {
  const names = new Set([
    ...Object.keys(calls),
    ...Object.keys(results),
    ...Object.keys(errors),
    ...Object.keys(repeatedExactCalls),
  ]);
  return Array.from(names)
    .map((name) => {
      const callCount = calls[name] ?? 0;
      const resultCount = results[name] ?? 0;
      const errorCount = errors[name] ?? 0;
      return {
        name,
        calls: callCount,
        results: resultCount,
        errors: errorCount,
        errorRate: resultCount > 0 ? Number((errorCount / resultCount).toFixed(4)) : 0,
        repeatedExactCalls: repeatedExactCalls[name] ?? 0,
      };
    })
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name));
}

async function auditFile(filePath, aggregate) {
  const fileName = basename(filePath);
  const performanceFixture = fileName.startsWith('perf-');
  const bytes = statSync(filePath).size;
  const overlaysByTarget = new Map();
  let lineNumber = 0;
  let bashPolicyRejectedThisTurn = false;
  let lastToolSignature = null;

  aggregate.totals.files += 1;
  aggregate.totals.bytes += bytes;
  aggregate.totals[performanceFixture ? 'performanceFixtures' : 'realSessions'] += 1;
  if (bytes > OVERSIZED_SESSION_BYTES) {
    aggregate.findings.oversizedSessions.push({
      file: fileName,
      bytes,
      performanceFixture,
    });
  }

  const lines = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    lineNumber += 1;
    aggregate.totals.lines += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      aggregate.totals.malformedLines += 1;
      aggregate.findings.malformedLines.push({
        file: fileName,
        line: lineNumber,
        containsNul: line.includes('\0'),
        performanceFixture,
      });
      continue;
    }

    if (
      entry?.type === 'custom'
      && entry.customType === 'pivi/message-ui'
      && typeof entry.data?.targetEntryId === 'string'
    ) {
      const targetEntryId = entry.data.targetEntryId;
      overlaysByTarget.set(targetEntryId, (overlaysByTarget.get(targetEntryId) ?? 0) + 1);
    }

    if (performanceFixture || entry?.type !== 'message' || !entry.message) {
      continue;
    }
    const message = entry.message;
    if (message.role === 'user') {
      bashPolicyRejectedThisTurn = false;
      lastToolSignature = null;
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item?.type !== 'toolCall' || typeof item.name !== 'string') {
          continue;
        }
        increment(aggregate.toolCalls, item.name);
        const signature = `${item.name}\0${JSON.stringify(item.arguments ?? {})}`;
        if (signature === lastToolSignature) {
          increment(aggregate.repeatedExactCalls, item.name);
        }
        lastToolSignature = signature;
        if (item.name === 'obsidian_bash') {
          aggregate.bash.calls += 1;
          if (bashPolicyRejectedThisTurn) {
            aggregate.bash.retriesAfterPolicyRejection += 1;
          }
        }
      }
      continue;
    }
    if (message.role !== 'toolResult' || typeof message.toolName !== 'string') {
      continue;
    }

    increment(aggregate.toolResults, message.toolName);
    if (message.isError) {
      increment(aggregate.toolErrors, message.toolName);
    }
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > OVERSIZED_TOOL_RESULT_BYTES) {
      aggregate.findings.oversizedToolResults.push({
        file: fileName,
        tool: message.toolName,
        bytes: lineBytes,
      });
    }
    if (message.toolName === 'obsidian_bash') {
      aggregate.bash.results += 1;
      if (message.isError) {
        aggregate.bash.errors += 1;
      }
      if (message.isError && BASH_POLICY_ERROR.test(getToolResultText(message))) {
        aggregate.bash.policyRejections += 1;
        bashPolicyRejectedThisTurn = true;
      }
    }
  }

  let maximumOverlayCount = 0;
  for (const count of overlaysByTarget.values()) {
    maximumOverlayCount = Math.max(maximumOverlayCount, count);
  }
  if (maximumOverlayCount > MESSAGE_UI_OVERLAY_LIMIT) {
    aggregate.findings.overlayAmplification.push({
      file: fileName,
      maximumEntriesPerTarget: maximumOverlayCount,
      performanceFixture,
    });
  }
}

export async function auditSessions(inputPath) {
  const sessionsDirectory = resolveSessionsDirectory(inputPath);
  const aggregate = {
    totals: {
      files: 0,
      realSessions: 0,
      performanceFixtures: 0,
      bytes: 0,
      lines: 0,
      malformedLines: 0,
    },
    toolCalls: {},
    toolResults: {},
    toolErrors: {},
    repeatedExactCalls: {},
    bash: {
      calls: 0,
      results: 0,
      errors: 0,
      policyRejections: 0,
      retriesAfterPolicyRejection: 0,
    },
    findings: {
      malformedLines: [],
      oversizedToolResults: [],
      oversizedSessions: [],
      overlayAmplification: [],
    },
  };

  for (const filePath of collectJsonlFiles(sessionsDirectory)) {
    await auditFile(filePath, aggregate);
  }

  return {
    thresholds: {
      oversizedToolResultBytes: OVERSIZED_TOOL_RESULT_BYTES,
      oversizedSessionBytes: OVERSIZED_SESSION_BYTES,
      messageUiEntriesPerTarget: MESSAGE_UI_OVERLAY_LIMIT,
    },
    totals: aggregate.totals,
    tools: toolRows(
      aggregate.toolCalls,
      aggregate.toolResults,
      aggregate.toolErrors,
      aggregate.repeatedExactCalls,
    ),
    bash: aggregate.bash,
    findings: aggregate.findings,
  };
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function formatSessionAudit(report) {
  const lines = [
    'Pivi session audit',
    `Sessions: ${report.totals.files} (${report.totals.realSessions} real, ${report.totals.performanceFixtures} perf)`,
    `Size: ${formatBytes(report.totals.bytes)} across ${report.totals.lines} JSONL lines`,
    `Malformed lines: ${report.totals.malformedLines}`,
    '',
    'Tools (real sessions only):',
  ];
  if (report.tools.length === 0) {
    lines.push('- none');
  } else {
    for (const tool of report.tools) {
      lines.push(`- ${tool.name}: ${tool.calls} calls, ${tool.errors}/${tool.results} errors, ${tool.repeatedExactCalls} exact repeats`);
    }
  }
  lines.push(
    '',
    `Bash: ${report.bash.calls} calls, ${report.bash.errors}/${report.bash.results} errors,`
      + ` ${report.bash.policyRejections} policy rejections,`
      + ` ${report.bash.retriesAfterPolicyRejection} later calls in the same rejected turn`,
    '',
    'Findings:',
    `- malformed JSONL lines: ${report.findings.malformedLines.length}`,
    `- tool results over ${report.thresholds.oversizedToolResultBytes} bytes: ${report.findings.oversizedToolResults.length}`,
    `- sessions over ${formatBytes(report.thresholds.oversizedSessionBytes)}: ${report.findings.oversizedSessions.length}`,
    `- message-ui targets over ${report.thresholds.messageUiEntriesPerTarget} entries: ${report.findings.overlayAmplification.length}`,
  );
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const positional = args.filter((arg) => arg !== '--json');
  if (positional.length !== 1 || args.some((arg) => arg.startsWith('--') && arg !== '--json')) {
    throw new Error(usage());
  }
  const report = await auditSessions(positional[0]);
  process.stdout.write(`${json ? JSON.stringify(report, null, 2) : formatSessionAudit(report)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
