import type { App } from 'obsidian';

import { ObsidianDeviceLocalSessionJournalStore } from '@/app/deviceLocalSessionJournalStore';
import { emptySessionJournalState } from '@pivi/pivi-agent-core/session/sessionJournal';

interface FakeApp {
  loadLocalStorage: jest.Mock;
  saveLocalStorage: jest.Mock;
}

function makeApp(stored: unknown): FakeApp {
  return {
    loadLocalStorage: jest.fn(() => stored),
    saveLocalStorage: jest.fn(),
  };
}

describe('ObsidianDeviceLocalSessionJournalStore', () => {
  it('returns an empty journal when storage is unset', () => {
    const store = new ObsidianDeviceLocalSessionJournalStore(makeApp(null) as unknown as App);
    expect(store.load()).toEqual(emptySessionJournalState());
  });

  it('resets to an empty journal and warns when storage is a corrupt string', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const store = new ObsidianDeviceLocalSessionJournalStore(makeApp('corrupt-blob') as unknown as App);
    expect(store.load()).toEqual(emptySessionJournalState());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/corrupt/i));
    warn.mockRestore();
  });

  it('resets to an empty journal and warns when storage is a non-record array', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const store = new ObsidianDeviceLocalSessionJournalStore(makeApp([1, 2, 3]) as unknown as App);
    expect(store.load()).toEqual(emptySessionJournalState());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/corrupt/i));
    warn.mockRestore();
  });

  it('loads a valid record journal without warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const valid = { version: 1, entries: [], recoveredIdentities: {} };
    const store = new ObsidianDeviceLocalSessionJournalStore(makeApp(valid) as unknown as App);
    expect(store.load()).toEqual(emptySessionJournalState());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
