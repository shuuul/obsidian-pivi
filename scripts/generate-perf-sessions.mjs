#!/usr/bin/env node

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SESSION_VERSION = 3;
const BASE_TIMESTAMP_MS = Date.parse('2026-07-15T00:00:00.000Z');
const MARKDOWN_TARGET_BYTES = 100 * 1024;
const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
});

function isoTimestamp(offset) {
  return new Date(BASE_TIMESTAMP_MS + offset * 1_000).toISOString();
}

function assistantMessage(text, timestamp, stopReason = 'stop', extraContent = []) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }, ...extraContent],
    api: 'openai-responses',
    provider: 'openai',
    model: 'perf-fixture-model',
    usage: EMPTY_USAGE,
    stopReason,
    timestamp,
  };
}

class SessionFixture {
  constructor(id, vaultPath, title) {
    this.id = id;
    this.title = title;
    this.entries = [{
      type: 'session',
      version: SESSION_VERSION,
      id,
      timestamp: isoTimestamp(0),
      cwd: vaultPath,
    }];
    this.parentId = null;
    this.offset = 1;
    this.append('custom', 'session-meta', {
      customType: 'pivi/session-meta',
      data: {
        title,
        titleSource: 'custom',
        createdAt: BASE_TIMESTAMP_MS,
        lastResponseAt: BASE_TIMESTAMP_MS,
      },
    });
  }

  append(type, id, fields) {
    this.entries.push({
      type,
      id,
      parentId: this.parentId,
      timestamp: isoTimestamp(this.offset),
      ...fields,
    });
    this.parentId = id;
    this.offset += 1;
    return id;
  }

  appendUser(id, content) {
    const timestamp = BASE_TIMESTAMP_MS + this.offset * 1_000;
    return this.append('message', id, {
      message: { role: 'user', content, timestamp },
    });
  }

  appendAssistant(id, content, stopReason = 'stop', extraContent = []) {
    const timestamp = BASE_TIMESTAMP_MS + this.offset * 1_000;
    return this.append('message', id, {
      message: assistantMessage(content, timestamp, stopReason, extraContent),
    });
  }

  appendToolResult(id, toolCallId, text) {
    const timestamp = BASE_TIMESTAMP_MS + this.offset * 1_000;
    return this.append('message', id, {
      message: {
        role: 'toolResult',
        toolCallId,
        toolName: 'spawn_agent',
        content: [{ type: 'text', text }],
        isError: false,
        timestamp,
      },
    });
  }

  appendMessageUi(id, data) {
    return this.append('custom', id, {
      customType: 'pivi/message-ui',
      data,
    });
  }

  serialize() {
    return `${this.entries.map(entry => JSON.stringify(entry)).join('\n')}\n`;
  }
}

function createTranscriptFixture(vaultPath, messageCount) {
  const label = messageCount === 1_000 ? '1K' : '5K';
  const fixture = new SessionFixture(
    `perf-fixture-${messageCount}`,
    vaultPath,
    `Perf fixture · ${label} messages`,
  );
  for (let index = 0; index < messageCount; index += 1) {
    const number = String(index + 1).padStart(5, '0');
    if (index % 2 === 0) {
      fixture.appendUser(`message-${number}`, `Fixture user message ${number}.`);
    } else {
      fixture.appendAssistant(
        `message-${number}`,
        `Fixture assistant message ${number}. This row has stable text for scroll measurements.`,
      );
    }
  }
  return fixture;
}

function createLargeMarkdown() {
  const heading = '# 100KB Markdown performance fixture\n\n';
  const paragraph = [
    '## Stable section\n\n',
    'This paragraph contains **bold text**, `inline code`, a [link](https://example.com), ',
    'and enough plain prose to exercise Obsidian Markdown rendering.\n\n',
  ].join('');
  let markdown = heading;
  while (Buffer.byteLength(markdown + paragraph, 'utf8') <= MARKDOWN_TARGET_BYTES) {
    markdown += paragraph;
  }
  return markdown + 'x'.repeat(MARKDOWN_TARGET_BYTES - Buffer.byteLength(markdown, 'utf8'));
}

function createMarkdownFixture(vaultPath) {
  const fixture = new SessionFixture(
    'perf-fixture-100kb-markdown',
    vaultPath,
    'Perf fixture · 100KB Markdown',
  );
  fixture.appendUser('markdown-user', 'Render the large Markdown fixture.');
  fixture.appendAssistant('markdown-assistant', createLargeMarkdown());
  return fixture;
}

function createSubagentsFixture(vaultPath) {
  const fixture = new SessionFixture(
    'perf-fixture-20-subagents',
    vaultPath,
    'Perf fixture · 20 subagents',
  );
  fixture.appendUser('agents-user', 'Run twenty deterministic delegated tasks.');
  const toolCalls = Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return {
      id: `agent-tool-${number}`,
      name: 'spawn_agent',
      arguments: { description: `Fixture Agent ${number}` },
    };
  });
  fixture.appendAssistant(
    'agents-assistant',
    'Delegating deterministic fixture work.',
    'toolUse',
    toolCalls.map(toolCall => ({ type: 'toolCall', ...toolCall })),
  );
  for (const toolCall of toolCalls) {
    fixture.appendToolResult(
      `result-${toolCall.id}`,
      toolCall.id,
      `${toolCall.arguments.description} completed.`,
    );
  }
  fixture.appendMessageUi('agents-ui', {
    targetEntryId: 'agents-assistant',
    assistantMessageId: 'agents-assistant',
    contentBlocks: [
      { type: 'text', content: 'Delegating deterministic fixture work.' },
      ...toolCalls.map(toolCall => ({
        type: 'subagent',
        subagentId: toolCall.id,
        mode: 'async',
      })),
    ],
    toolCalls: toolCalls.map((toolCall, index) => ({
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.arguments,
      status: 'completed',
      result: `${toolCall.arguments.description} completed.`,
      isExpanded: false,
      subagent: {
        id: toolCall.id,
        writerName: `Agent ${String(index + 1).padStart(2, '0')}`,
        description: toolCall.arguments.description,
        prompt: `Complete deterministic task ${index + 1}.`,
        mode: 'async',
        isExpanded: false,
        result: `${toolCall.arguments.description} completed.`,
        status: 'completed',
        asyncStatus: 'completed',
        agentId: `fixture-agent-${String(index + 1).padStart(2, '0')}`,
        startedAt: BASE_TIMESTAMP_MS + (index + 1) * 1_000,
        completedAt: BASE_TIMESTAMP_MS + (index + 2) * 1_000,
        toolCalls: [],
      },
    })),
  });
  fixture.appendAssistant('agents-conclusion', 'All twenty fixture subagents completed.');
  return fixture;
}

export function generatePerfSessions(vaultPathInput) {
  if (!vaultPathInput?.trim()) {
    throw new Error('Usage: node scripts/generate-perf-sessions.mjs <vault>');
  }
  const vaultPath = resolve(vaultPathInput);
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultPath}`);
  }
  const sessionsDirectory = join(vaultPath, '.pivi', 'sessions');
  mkdirSync(sessionsDirectory, { recursive: true });
  const fixtures = [
    ['perf-001-1k-messages.jsonl', createTranscriptFixture(vaultPath, 1_000)],
    ['perf-002-5k-messages.jsonl', createTranscriptFixture(vaultPath, 5_000)],
    ['perf-003-100kb-markdown.jsonl', createMarkdownFixture(vaultPath)],
    ['perf-004-20-subagents.jsonl', createSubagentsFixture(vaultPath)],
  ];
  for (const [fileName, fixture] of fixtures) {
    writeFileSync(join(sessionsDirectory, fileName), fixture.serialize(), 'utf8');
  }
  return fixtures.map(([fileName, fixture]) => ({
    fileName,
    sessionId: fixture.id,
    title: fixture.title,
    entryCount: fixture.entries.length - 1,
  }));
}

async function main() {
  const generated = generatePerfSessions(process.argv[2]);
  process.stdout.write([
    `Generated ${generated.length} performance sessions:`,
    ...generated.map(fixture => (
      `- ${fixture.fileName} (${fixture.entryCount} entries; ${fixture.title})`
    )),
    '',
  ].join('\n'));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
