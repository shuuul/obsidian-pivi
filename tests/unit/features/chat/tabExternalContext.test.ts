import { syncTabSessionExternalContext } from '@/ui/chat/tabs/tabExternalContext';
import type { TabData } from '@/ui/chat/tabs/types';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';

describe('syncTabSessionExternalContext', () => {
  it('preserves the current selection when restarting a runtime', () => {
    const service = createFakePiChatService();
    const resetForSession = jest.fn();
    const tab = {
      service,
      ui: {
        externalContextSelector: {
          getExternalContexts: () => ['/current/root'],
          resetForSession,
        },
      },
    } as unknown as TabData;

    const result = syncTabSessionExternalContext(
      tab,
      { sessionFile: 'sessions/current.jsonl' },
      ['/pinned/root'],
    );

    expect(resetForSession).not.toHaveBeenCalled();
    expect(result).toEqual(['/current/root']);
    expect(service.syncSession).toHaveBeenCalledWith(
      { sessionFile: 'sessions/current.jsonl' },
      ['/current/root'],
    );
  });

  it('resets ephemeral roots before synchronizing a changed session', () => {
    const service = createFakePiChatService();
    let selectedPaths = ['/old/root'];
    const tab = {
      service,
      ui: {
        externalContextSelector: {
          getExternalContexts: () => selectedPaths,
          resetForSession: jest.fn((paths: string[]) => {
            selectedPaths = [...paths];
          }),
        },
      },
    } as unknown as TabData;

    const result = syncTabSessionExternalContext(
      tab,
      null,
      ['/pinned/root'],
      { resetSelection: true },
    );

    expect(result).toEqual(['/pinned/root']);
    expect(service.syncSession).toHaveBeenCalledWith(null, ['/pinned/root']);
  });
});
