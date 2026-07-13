import { registerPiviCommands } from '@/app/commandRegistration';
import type { PiviChatView, PiviChatViewCommands } from '@/app/hostContracts';
import { findPiviView } from '@/app/viewAccess';

jest.mock('@/app/viewAccess', () => ({
  findPiviView: jest.fn(),
}));

type RegisteredCommand = {
  id: string;
  checkCallback?: (checking: boolean) => boolean;
};

function createPlugin() {
  const commands: RegisteredCommand[] = [];
  return {
    commands,
    plugin: {
      app: {
        workspace: {
          on: jest.fn(() => ({})),
          getActiveViewOfType: jest.fn(() => null),
        },
      },
      addCommand: jest.fn((command: RegisteredCommand) => {
        commands.push(command);
      }),
      registerEvent: jest.fn(),
      activateView: jest.fn(async () => undefined),
      addEditorSelectionToChatInput: jest.fn(async () => undefined),
      canCreateNewTab: jest.fn(() => true),
      openNewTab: jest.fn(async () => undefined),
    },
  };
}

function createView(commands: PiviChatViewCommands): PiviChatView {
  return {
    leaf: {} as never,
    getChatHandle: () => ({
      commands,
      maintenance: {} as never,
    }),
  };
}

describe('chat command registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checks semantic command state before starting or closing an active chat', () => {
    const startNewSession = jest.fn(async () => true);
    const closeActiveTab = jest.fn(async () => true);
    const getState = jest.fn(() => ({
      mounted: true,
      canCreateTab: true,
      canStartNewSession: true,
      canCloseActiveTab: true,
    }));
    jest.mocked(findPiviView).mockReturnValue(createView({
      getState,
      startNewSession,
      closeActiveTab,
    } as unknown as PiviChatViewCommands));
    const { commands, plugin } = createPlugin();

    registerPiviCommands(plugin as never);
    const newSession = commands.find(command => command.id === 'new-session');
    const closeTab = commands.find(command => command.id === 'close-current-tab');

    expect(newSession?.checkCallback?.(true)).toBe(true);
    expect(closeTab?.checkCallback?.(true)).toBe(true);
    expect(startNewSession).not.toHaveBeenCalled();
    expect(closeActiveTab).not.toHaveBeenCalled();

    expect(newSession?.checkCallback?.(false)).toBe(true);
    expect(closeTab?.checkCallback?.(false)).toBe(true);
    expect(startNewSession).toHaveBeenCalledTimes(1);
    expect(closeActiveTab).toHaveBeenCalledTimes(1);
  });

  it('disables session commands when there is no mounted capable view', () => {
    const { commands, plugin } = createPlugin();
    jest.mocked(findPiviView).mockReturnValue(null);
    registerPiviCommands(plugin as never);

    expect(commands.find(command => command.id === 'new-session')
      ?.checkCallback?.(true)).toBe(false);
    expect(commands.find(command => command.id === 'close-current-tab')
      ?.checkCallback?.(true)).toBe(false);
  });
});
