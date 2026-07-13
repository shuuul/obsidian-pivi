import type { PiviChatView, PiviChatViewHandle } from '@/app/hostContracts';
import { activateOpenSessionElsewhere } from '@/app/ui/activateOpenSessionElsewhere';

function createView(
  leaf: PiviChatView['leaf'],
  options: { hasSession?: boolean; activateResult?: boolean } = {},
): {
  view: PiviChatView;
  handle: PiviChatViewHandle;
} {
  const handle = {
    maintenance: {
      hasSession: jest.fn(() => options.hasSession ?? false),
      activateSession: jest.fn(async () => options.activateResult ?? true),
    },
  } as unknown as PiviChatViewHandle;
  return {
    view: { leaf, getChatHandle: () => handle },
    handle,
  };
}

describe('activateOpenSessionElsewhere', () => {
  it('reveals and activates the first matching view other than the current leaf', async () => {
    const currentLeaf = {} as PiviChatView['leaf'];
    const otherLeaf = {} as PiviChatView['leaf'];
    const current = createView(currentLeaf, { hasSession: true });
    const other = createView(otherLeaf, { hasSession: true });
    const revealLeaf = jest.fn(async () => {});

    await expect(activateOpenSessionElsewhere({
      views: [current.view, other.view],
      currentLeaf,
      openSessionId: 'session-1',
      revealLeaf,
    })).resolves.toBe(true);

    expect(current.handle.maintenance.hasSession).not.toHaveBeenCalled();
    expect(revealLeaf).toHaveBeenCalledWith(otherLeaf);
    expect(other.handle.maintenance.activateSession).toHaveBeenCalledWith('session-1');
  });

  it('does not reveal a view when no other mounted handle owns the session', async () => {
    const currentLeaf = {} as PiviChatView['leaf'];
    const other = createView({} as PiviChatView['leaf']);
    const revealLeaf = jest.fn(async () => {});

    await expect(activateOpenSessionElsewhere({
      views: [other.view],
      currentLeaf,
      openSessionId: 'missing',
      revealLeaf,
    })).resolves.toBe(false);

    expect(revealLeaf).not.toHaveBeenCalled();
    expect(other.handle.maintenance.activateSession).not.toHaveBeenCalled();
  });
});
