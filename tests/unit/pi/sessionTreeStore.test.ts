import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { SessionTreeStore } from '@pivi/pivi-agent-core/engine/pi/session/sessionTreeStore';
import {
  missingAgentMessages,
  sanitizeAgentMessagesForLlm,
} from '@pivi/pivi-agent-core/engine/pi/session/agentMessageHistory';
import { PIVI_MESSAGE_UI } from '@pivi/pivi-agent-core/session';

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
      isPersisted(): boolean;
      _rewriteFile(): void;
    }
    const manager: PersistedTestManager = {
      flushed: false,
      isPersisted: () => true,
      _rewriteFile: jest.fn(),
    };
    const StoreCtor = SessionTreeStore as unknown as {
      new(vaultPath: string, manager: PersistedTestManager): SessionTreeStore;
    };
    const store = new StoreCtor('/vault', manager);

    store.flushToDisk();

    expect(manager._rewriteFile).toHaveBeenCalledTimes(1);
    expect(manager.flushed).toBe(true);
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
