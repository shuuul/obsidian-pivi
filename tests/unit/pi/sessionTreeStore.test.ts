import type { AgentMessage } from '@earendil-works/pi-agent-core';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { captureSessionJsonlSource } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlIndex';
import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import {
  missingAgentMessages,
  sanitizeAgentMessagesForLlm,
} from '@pivi/pivi-agent-core/engine/pi/session/agentMessageHistory';
import { PIVI_MESSAGE_UI } from '@pivi/pivi-agent-core/session';
import { SessionIndexStaleError } from '@pivi/pivi-agent-core/session';

const assistantToolCall = {
  role: 'assistant',
  content: [{ type: 'toolCall', id: 'call-1', name: 'obsidian_read', arguments: { path: 'A.md' } }],
  api: 'openai',
  provider: 'deepseek',
  model: 'deepseek-chat',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: 'toolUse',
  timestamp: 2,
};

const toolResult = {
  role: 'toolResult',
  toolCallId: 'call-1',
  toolName: 'obsidian_read',
  content: [{ type: 'text', text: 'file contents' }],
  isError: false,
  timestamp: 3,
};

describe('SessionTreeStore', () => {
  it('strips device-local external paths at the JSONL message UI boundary', () => {
    const store = SessionTreeStore.inMemory('/test/vault-message-ui-privacy');

    store.appendMessageUi({
      targetEntryId: 'user-1',
      turnRequest: {
        text: 'inspect project',
        externalContextPaths: ['/Users/example/private-project'],
      },
    });

    const persisted = store.getEntries().find((entry) => (
      entry.type === 'custom' && entry.customType === PIVI_MESSAGE_UI
    ));
    expect(JSON.stringify(persisted)).not.toContain('externalContextPaths');
    expect(persisted).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        turnRequest: { text: 'inspect project' },
      }),
    }));
  });

  it('marks the Pi manager flushed after Pivi eagerly rewrites a persisted file', () => {
    interface PersistedTestManager {
      flushed: boolean;
      getSessionFile(): string | undefined;
      isPersisted(): boolean;
      _rewriteFile(): void;
    }
    const manager: PersistedTestManager = {
      flushed: false,
      getSessionFile: () => undefined,
      isPersisted: () => true,
      _rewriteFile: jest.fn(),
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, manager: PersistedTestManager): SessionTreeStore;
    };
    const store = new StoreCtor('/vault', manager);

    (store as unknown as { rewriteToDisk(): void }).rewriteToDisk();

    expect(manager._rewriteFile).toHaveBeenCalledTimes(1);
    expect(manager.flushed).toBe(true);
  });

  it('uses Pi append methods without rewriting the persisted file', () => {
    const manager = {
      appendMessage: jest.fn(() => 'user-1'),
      getSessionFile: () => '/vault/.pivi/sessions/session.jsonl',
      isPersisted: () => false,
      _rewriteFile: jest.fn(),
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, testManager: typeof manager): SessionTreeStore;
    };
    const store = new StoreCtor('/vault', manager);

    expect(store.appendUserMessage('hello')).toBe('user-1');

    expect(manager.appendMessage).toHaveBeenCalledTimes(1);
    expect(manager._rewriteFile).not.toHaveBeenCalled();
  });

  it('rejects a live append before writing when the source changed externally', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-live-session-'));
    const sessionFile = path.join(root, 'session.jsonl');
    fs.writeFileSync(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: root,
    })}\n`);
    const manager = {
      appendMessage: jest.fn(() => 'user-1'),
      getSessionFile: () => sessionFile,
      isPersisted: () => true,
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, testManager: typeof manager): SessionTreeStore;
    };
    const store = new StoreCtor(root, manager);
    (store as unknown as { sourceFingerprint: unknown }).sourceFingerprint =
      captureSessionJsonlSource(sessionFile);
    fs.appendFileSync(sessionFile, `${JSON.stringify({
      type: 'custom',
      customType: 'external',
      id: 'external-1',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
    })}\n`);

    expect(() => store.appendUserMessage('must not write')).toThrow(SessionIndexStaleError);
    expect(manager.appendMessage).not.toHaveBeenCalled();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects stale UI save, redo, fork, and compaction before mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-live-mutations-'));
    const sessionFile = path.join(root, 'session.jsonl');
    const header = {
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: root,
    };
    fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`);
    const manager = {
      appendCompaction: jest.fn(() => 'compaction-1'),
      appendCustomEntry: jest.fn(() => 'ui-1'),
      createBranchedSession: jest.fn(() => path.join(root, 'fork.jsonl')),
      fileEntries: [header],
      getSessionFile: () => sessionFile,
      isPersisted: () => true,
      _buildIndex: jest.fn(),
      _rewriteFile: jest.fn(),
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, testManager: typeof manager): SessionTreeStore;
    };
    const store = new StoreCtor(root, manager);
    (store as unknown as { sourceFingerprint: unknown }).sourceFingerprint =
      captureSessionJsonlSource(sessionFile);
    const before = fs.readFileSync(sessionFile);
    fs.appendFileSync(sessionFile, `${JSON.stringify({
      type: 'custom',
      customType: 'external',
      id: 'external-1',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
    })}\n`);
    const externallyChanged = fs.readFileSync(sessionFile);

    expect(() => store.appendMessageUi({ targetEntryId: 'user-1', durationSeconds: 1 }))
      .toThrow(SessionIndexStaleError);
    expect(() => store.truncateAfter(null)).toThrow(SessionIndexStaleError);
    expect(() => store.forkToNewFile('user-1')).toThrow(SessionIndexStaleError);
    expect(() => store.appendCompaction('summary', 'user-1', 10))
      .toThrow(SessionIndexStaleError);

    expect(manager.appendCustomEntry).not.toHaveBeenCalled();
    expect(manager._buildIndex).not.toHaveBeenCalled();
    expect(manager._rewriteFile).not.toHaveBeenCalled();
    expect(manager.createBranchedSession).not.toHaveBeenCalled();
    expect(manager.appendCompaction).not.toHaveBeenCalled();
    expect(fs.readFileSync(sessionFile)).toEqual(externallyChanged);
    expect(externallyChanged).not.toEqual(before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses the held live fingerprint before the production fork path', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-live-fork-'));
    const sessionFile = path.join(root, 'session.jsonl');
    fs.writeFileSync(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: root,
    })}\n`);
    const manager = {
      createBranchedSession: jest.fn(() => path.join(root, 'fork.jsonl')),
      getSessionFile: () => sessionFile,
      isPersisted: () => true,
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, testManager: typeof manager): SessionTreeStore;
    };
    const store = new StoreCtor(root, manager);
    (store as unknown as { sourceFingerprint: unknown }).sourceFingerprint =
      captureSessionJsonlSource(sessionFile);
    (store as unknown as { registerLive(): void }).registerLive();
    fs.appendFileSync(sessionFile, '{"external":true}\n');

    expect(() => SessionTreeStore.forkFile(root, 'session.jsonl', 'user-1'))
      .toThrow(SessionIndexStaleError);
    expect(manager.createBranchedSession).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'fork.jsonl'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ignores invalid leafId when opening a session', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    const defaultLeaf = store.getLeafId();

    const reopened = SessionTreeStore.open('/test/vault', '.pivi/sessions/mock.jsonl', 'deadbeef');
    expect(reopened.getLeafId()).toBe(defaultLeaf);
  });

  it('applies valid leafId when opening a session', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    store.applyLeafId('entry-1');
    expect(store.getLeafId()).toBe('entry-1');
  });

  it('reuses live store when reopening before assistant flush', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    store.appendCustomMeta({ title: 'live', createdAt: Date.now() });
    const sessionFile = store.getVaultRelativeSessionFile();
    expect(sessionFile).toBeTruthy();

    const reopened = SessionTreeStore.open('/test/vault', sessionFile!, 'missing-leaf');
    expect(reopened.getLeafId()).toBe(store.getLeafId());
  });

  it('keeps Pivi custom entries out of agent message context', () => {
    const store = SessionTreeStore.inMemory('/test/vault');

    store.appendUserMessage('hello');
    store.appendCustomMeta({ title: 'metadata only', createdAt: 1 });
    store.appendUiContext({ currentNote: 'Daily.md' });

    expect(store.loadAgentMessages()).toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
    ]);
  });

  it('applies persisted async subagent UI results to restored model tool results', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    store.syncAgentMessages([
      { role: 'user', content: 'read cards' },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'spawn-1',
          name: 'spawn_agent',
          arguments: { message: 'read card', run_in_background: true },
        }],
      },
      {
        role: 'toolResult',
        toolCallId: 'spawn-1',
        toolName: 'spawn_agent',
        content: [{ type: 'text', text: '{"agent_id":"subagent-1","status":"running"}' }],
        isError: false,
      },
      { role: 'assistant', content: 'Waiting for the background task.' },
    ] as AgentMessage[]);
    store.appendMessageUi({
      targetEntryId: store.findLastVisibleMessageEntryId('assistant') ?? 'assistant-1',
      toolCalls: [{
        id: 'spawn-1',
        name: 'spawn_agent',
        input: { run_in_background: true },
        status: 'completed',
        isExpanded: false,
        subagent: {
          id: 'spawn-1',
          agentId: 'subagent-1',
          mode: 'async',
          description: 'Read card',
          prompt: 'read card',
          status: 'completed',
          asyncStatus: 'completed',
          result: 'final card report',
          toolCalls: [],
          isExpanded: false,
        },
      }],
    });

    const restoredToolResult = store.loadAgentMessages().find((message) => (
      (message as { role?: string; toolCallId?: string }).role === 'toolResult'
      && (message as { role?: string; toolCallId?: string }).toolCallId === 'spawn-1'
    )) as { content: Array<{ type: string; text: string }> } | undefined;

    expect(restoredToolResult?.content[0]?.text).toContain('final card report');
    expect(restoredToolResult?.content[0]?.text).toContain('subagent-1 completed');
  });

  it('restores a compact persisted async report while retaining legacy raw fallback', () => {
    const store = SessionTreeStore.inMemory('/test/persisted-agent-report');
    store.syncAgentMessages([
      { role: 'user', content: 'read cards' },
      {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'spawn-report',
          name: 'spawn_agent',
          arguments: { message: 'read card', run_in_background: true },
        }],
      },
      {
        role: 'toolResult',
        toolCallId: 'spawn-report',
        toolName: 'spawn_agent',
        content: [{ type: 'text', text: 'running' }],
        isError: false,
      },
      { role: 'assistant', content: 'Waiting.' },
    ] as AgentMessage[]);
    store.appendMessageUi({
      targetEntryId: store.findLastVisibleMessageEntryId('assistant') ?? 'assistant-1',
      toolCalls: [{
        id: 'spawn-report',
        name: 'spawn_agent',
        input: { run_in_background: true },
        status: 'completed',
        result: 'raw report',
        toolUseResult: {
          agent_report: {
            schemaVersion: 1,
            objective: 'Read card',
            outcome: 'completed',
            findings: ['Card fact'],
          },
        },
        isExpanded: false,
        subagent: {
          id: 'spawn-report',
          agentId: 'subagent-report',
          mode: 'async',
          description: 'Read card',
          status: 'completed',
          asyncStatus: 'completed',
          result: 'raw report',
          toolCalls: [],
          isExpanded: false,
        },
      }],
    });

    const restored = store.loadAgentMessages().find((message) => (
      (message as { toolCallId?: string }).toolCallId === 'spawn-report'
    )) as { content: Array<{ text: string }> } | undefined;
    expect(restored?.content[0]?.text).toContain('Agent report objective: Read card');
    expect(restored?.content[0]?.text).toContain('Card fact');
    expect(restored?.content[0]?.text).not.toContain('raw report');
  });

  it('removes invalid Agent report paths at the message UI JSONL boundary', () => {
    const store = SessionTreeStore.inMemory('/test/agent-report-privacy');
    store.appendMessageUi({
      targetEntryId: 'assistant-1',
      toolCalls: [{
        id: 'spawn-private',
        name: 'spawn_agent',
        input: {},
        status: 'completed',
        isExpanded: false,
        toolUseResult: {
          result: 'legacy result',
          agent_report: {
            schemaVersion: 1,
            objective: 'Inspect',
            outcome: 'completed',
            artifacts: [{ label: 'Private', vaultPath: '/Users/example/private' }],
          },
        },
      }],
    });

    const persisted = store.getEntries().find((entry) => (
      entry.type === 'custom' && entry.customType === PIVI_MESSAGE_UI
    ));
    expect(JSON.stringify(persisted)).not.toContain('/Users/example/private');
    expect(persisted).not.toHaveProperty('data.toolCalls.0.toolUseResult.agent_report');
    expect(persisted).toHaveProperty('data.toolCalls.0.toolUseResult.result', 'legacy result');
  });

  it('syncs only agent messages missing from the current leaf branch', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    store.appendUserMessage('hello');

    store.syncAgentMessages([
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'assistant', content: 'hi', timestamp: 2 },
    ] as never[]);
    store.syncAgentMessages([
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'assistant', content: 'hi', timestamp: 2 },
    ] as never[]);

    expect(store.loadAgentMessages().map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('does not duplicate the current user turn when API prompt text is transformed', () => {
    const store = SessionTreeStore.inMemory('/test/mcp-transform-sync');
    store.appendUserMessage('Ask @server about notes');

    store.syncAgentMessages([
      { role: 'user', content: 'Ask @server MCP about notes', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
    ] as never[], {
      userMessageEquivalences: [{
        existingText: 'Ask @server about notes',
        incomingText: 'Ask @server MCP about notes',
      }],
    });

    expect(store.loadAgentMessages().map((message) => ({
      role: message.role,
      content: (message as { content?: unknown }).content,
    }))).toEqual([
      { role: 'user', content: 'Ask @server about notes' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ]);
  });

  it('syncs a run-local tool turn after the pre-persisted user prompt', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    store.appendUserMessage('first');
    store.syncAgentMessages([
      { role: 'user', content: 'first', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
    ] as never[]);

    store.appendUserMessage('second');
    store.syncAgentMessages([
      { role: 'user', content: 'second', timestamp: 3 },
      assistantToolCall,
      toolResult,
      { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 4 },
    ] as never[]);

    expect(store.loadAgentMessages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
  });

  it('finds the last visible message entry id for a requested role', () => {
    const store = SessionTreeStore.inMemory('/test/last-visible-role');
    const userId = store.appendUserMessage('hello');

    expect(store.findLastVisibleMessageEntryId('user')).toBe(userId);
    expect(store.findLastVisibleMessageEntryId('assistant')).toBeNull();

    store.syncAgentMessages([
      { role: 'user', content: 'hello', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 2 },
    ] as never[]);

    const assistantEntry = store.getEntries().find((entry) => (
      entry.type === 'message' && entry.message.role === 'assistant'
    ));
    expect(store.findLastVisibleMessageEntryId('assistant')).toBe(assistantEntry?.id);
  });

  it('truncates the current session to a checkpoint before appending a replacement turn', () => {
    const store = SessionTreeStore.inMemory('/test/truncate-redo');
    store.appendUserMessage('first');
    store.syncAgentMessages([
      { role: 'user', content: 'first', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }], timestamp: 2 },
    ] as never[]);
    const checkpoint = store.findLastVisibleMessageEntryId('assistant');
    expect(checkpoint).toBeTruthy();

    store.appendUserMessage('second');
    store.syncAgentMessages([
      { role: 'user', content: 'second', timestamp: 3 },
      { role: 'assistant', content: [{ type: 'text', text: 'second answer' }], timestamp: 4 },
    ] as never[]);
    expect(store.loadAgentMessages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);

    expect(store.truncateAfter(checkpoint)).toBe(true);
    expect(store.loadAgentMessages().map((message) => message.role)).toEqual(['user', 'assistant']);

    const replacementUser = store.appendUserMessage('second replacement');
    expect(store.getEntries().find((entry) => entry.id === replacementUser)?.parentId).toBe(checkpoint);
    expect(store.loadAgentMessages().map((message) => (
      (message as { content?: unknown }).content
    ))).toEqual([
      'first',
      [{ type: 'text', text: 'first answer' }],
      'second replacement',
    ]);
  });

  it('loads the visible append-order prefix for a checkpoint on a local branch', () => {
    const store = SessionTreeStore.inMemory('/test/visible-prefix');
    const root = store.appendCustomMeta({ title: 'root', createdAt: 1 });

    store.appendUserMessage('first');
    store.applyLeafId(root);
    store.appendUserMessage('second');
    store.syncAgentMessages([
      { role: 'user', content: 'second', timestamp: 2 },
      { role: 'assistant', content: [{ type: 'text', text: 'second answer' }], timestamp: 3 },
    ] as never[]);

    expect(store.loadAgentMessages().map((message) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
    ]);
    expect(store.loadAgentMessages().map((message) => (message as { content: unknown }).content)).toEqual([
      'first',
      'second',
      [{ type: 'text', text: 'second answer' }],
    ]);
  });

  it('loads compaction summaries plus recent kept messages for LLM context', () => {
    const store = SessionTreeStore.inMemory('/test/compaction-context');
    store.appendUserMessage('old request');
    store.syncAgentMessages([
      { role: 'user', content: 'old request', timestamp: 1 },
      { role: 'assistant', content: 'old answer', timestamp: 2 },
    ] as never[]);
    const keptUser = store.appendUserMessage('recent request');
    store.syncAgentMessages([
      { role: 'user', content: 'recent request', timestamp: 3 },
      { role: 'assistant', content: 'recent answer', timestamp: 4 },
    ] as never[]);

    store.appendCompaction('Summary of old request/answer.', keptUser, 1234);

    expect(store.loadAgentMessages().map((message) => ({
      role: message.role,
      content: (message as { content?: unknown }).content,
    }))).toEqual([
      {
        role: 'user',
        content: [{
          type: 'text',
          text: '<context_compaction_summary>\nSummary of old request/answer.\n</context_compaction_summary>',
        }],
      },
      { role: 'user', content: 'recent request' },
      { role: 'assistant', content: 'recent answer' },
    ]);
  });

  it('stores validated checkpoint details without changing legacy compaction context', () => {
    const store = SessionTreeStore.inMemory('/test/checkpoint-details');
    const userId = store.appendUserMessage('request');
    store.syncAgentMessages([
      { role: 'user', content: 'request', timestamp: 1 },
      { role: 'assistant', content: 'answer', timestamp: 2 },
    ] as never[]);
    const checkpoint = {
      schemaVersion: 1 as const,
      continuationSummary: 'Continue.',
      goal: 'Finish',
      constraints: [],
      decisions: ['Keep summary'],
      artifacts: [{ label: 'Spec', vaultPath: 'specs/005.md' }],
      openWork: [],
      unresolvedQuestions: [],
      nextSteps: ['Test'],
      source: { firstEntryId: userId, lastEntryId: userId, firstKeptEntryId: userId },
      tokenEstimates: { contextBefore: 100, checkpoint: 10 },
    };

    store.appendCompaction('Readable legacy summary.', userId, 100, { piviCheckpoint: checkpoint });

    const compaction = store.getEntries().find((entry) => entry.type === 'compaction');
    expect(compaction).toMatchObject({
      summary: 'Readable legacy summary.',
      details: { piviCheckpoint: checkpoint },
    });
    expect(store.loadAgentMessages()[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: expect.stringContaining('Readable legacy summary.') }],
    });
    expect(JSON.stringify(compaction)).not.toContain('/Users/');
  });

  it('omits malformed checkpoint details at the append boundary', () => {
    const store = SessionTreeStore.inMemory('/test/checkpoint-privacy');
    const userId = store.appendUserMessage('request');
    store.appendCompaction('Legacy summary.', userId, 100, {
      piviCheckpoint: {
        schemaVersion: 1,
        continuationSummary: 'Continue.',
        goal: null,
        constraints: [],
        decisions: [],
        artifacts: [{ label: 'Private', vaultPath: '/Users/example/private' }],
        openWork: [],
        unresolvedQuestions: [],
        nextSteps: [],
        source: { firstEntryId: userId, lastEntryId: userId, firstKeptEntryId: userId },
        tokenEstimates: { contextBefore: 100, checkpoint: 10 },
      },
    });

    const compaction = store.getEntries().find((entry) => entry.type === 'compaction');
    expect(compaction).not.toHaveProperty('details');
    expect(JSON.stringify(compaction)).not.toContain('/Users/example/private');
  });

  it('keeps trailing compaction in LLM context but outside the visible UI prefix', () => {
    const store = SessionTreeStore.inMemory('/test/trailing-compaction-boundary');
    const userId = store.appendUserMessage('request');
    store.syncAgentMessages([
      { role: 'user', content: 'request', timestamp: 1 },
      { role: 'assistant', content: 'answer', timestamp: 2 },
    ] as never[]);
    store.appendCompaction('Summary', userId, 100);

    expect(store.getLinearVisiblePrefix().map((entry) => entry.type)).toEqual([
      'message',
      'message',
    ]);
    expect(store.getLinearLlmContextEntries().map((entry) => entry.type)).toEqual([
      'message',
      'message',
      'compaction',
    ]);
  });
});

describe('agentMessageHistory', () => {
  it('finds the non-overlapping suffix between restored context and run messages', () => {
    const missing = missingAgentMessages([
      { role: 'user', content: 'first', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
      { role: 'user', content: 'second', timestamp: 3 },
    ] as never[], [
      { role: 'user', content: 'second', timestamp: 3 },
      assistantToolCall,
      toolResult,
    ] as never[]);

    expect(missing.map((message) => message.role)).toEqual(['assistant', 'toolResult']);
  });

  it('only treats configured user prompt transforms as overlapping', () => {
    const existing = [{ role: 'user', content: 'Ask @server', timestamp: 1 }] as never[];
    const incoming = [
      { role: 'user', content: 'Ask @server MCP', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
    ] as never[];

    expect(missingAgentMessages(existing, incoming).map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(missingAgentMessages(existing, incoming, {
      userMessageEquivalences: [{
        existingText: 'Ask @server',
        incomingText: 'Ask @server MCP',
      }],
    }).map((message) => message.role)).toEqual(['assistant']);
  });

  it('drops orphaned tool results before replaying restored history to the model', () => {
    const sanitized = sanitizeAgentMessagesForLlm([
      { role: 'user', content: 'first', timestamp: 1 },
      toolResult,
      assistantToolCall,
      toolResult,
      { role: 'assistant', content: [{ type: 'text', text: 'done' }], timestamp: 4 },
    ] as never[]);

    expect(sanitized.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
  });
});
