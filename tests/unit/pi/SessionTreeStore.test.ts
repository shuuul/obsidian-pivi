import { SessionTreeStore } from '../../../src/pi/session/SessionTreeStore';
import {
  missingAgentMessages,
  sanitizeAgentMessagesForLlm,
} from '../../../src/pi/session/agentMessageHistory';

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
