import { SessionTreeStore } from '../../../src/pi/session/SessionTreeStore';

describe('SessionTreeStore', () => {
  it('ignores invalid leafId when opening a session', () => {
    const store = SessionTreeStore.inMemory('/test/vault');
    const defaultLeaf = store.getLeafId();

    const reopened = SessionTreeStore.open('/test/vault', '.obsius/sessions/mock.jsonl', 'deadbeef');
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

  it('keeps Obsius custom entries out of agent message context', () => {
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
});
