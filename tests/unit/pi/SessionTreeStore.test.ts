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
});
