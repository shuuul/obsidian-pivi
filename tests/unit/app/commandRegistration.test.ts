import { registerPiviCommands } from '@/app/commandRegistration';
import type { PiviChatView, PiviChatViewCommands } from '@/app/hostContracts';
import { findPiviView } from '@/app/viewAccess';

jest.mock('@/app/viewAccess', () => ({
  findPiviView: jest.fn(),
}));

jest.mock('@/ui/shared/dom', () => ({
  getActiveWindow: jest.fn(() => ({})),
}));

type RegisteredCommand = {
  id: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
};

function createPlugin() {
  const commands: RegisteredCommand[] = [];
  const perfController = {
    enabled: true,
    start: jest.fn(),
    sampleHeap: jest.fn(),
    stopAndExport: jest.fn(async () => '.pivi/perf-traces/trace.json'),
    dispose: jest.fn(),
  };
  return {
    commands,
    perfController,
    plugin: {
      app: {
        vault: {
          adapter: {
            exists: jest.fn(async () => false),
            read: jest.fn(async () => ''),
          },
        },
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
      getChatPerfController: jest.fn(() => perfController),
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

  it('registers explicit development trace lifecycle commands', () => {
    const { commands, plugin } = createPlugin();

    registerPiviCommands(plugin as never);

    expect(commands.map(command => command.id)).toEqual(expect.arrayContaining([
      'debug-start-chat-performance-trace',
      'debug-sample-chat-performance-heap',
      'debug-run-20-agent-runs-workload',
      'debug-run-indexed-session-paging-workload',
      'debug-run-100kb-markdown-stream',
      'debug-run-tab-switching-workload',
      'debug-stop-chat-performance-trace',
    ]));
  });

  it('runs the deterministic Markdown stream through the mounted view', async () => {
    const run100KbMarkdownStream = jest.fn(async () => ({
      bytes: 100 * 1024,
      chunks: 64,
      durationMs: 1_000,
    }));
    jest.mocked(findPiviView).mockReturnValue({
      leaf: {} as never,
      getChatHandle: () => ({
        commands: {} as PiviChatViewCommands,
        maintenance: {} as never,
        development: {
          run20AgentRunsWorkload: jest.fn(),
          runIndexedSessionPagingWorkload: jest.fn(),
          run100KbMarkdownStream,
          runTabSwitchingWorkload: jest.fn(),
        },
      }),
    });
    const { commands, plugin } = createPlugin();
    registerPiviCommands(plugin as never);

    commands.find(command => command.id === 'debug-run-100kb-markdown-stream')?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(run100KbMarkdownStream).toHaveBeenCalledTimes(1);
  });

  it('exports the isolated 20 Agent-run trace through the mounted view', async () => {
    const run20AgentRunsWorkload = jest.fn(async (hooks: {
      afterRender(result: { agentRuns: number; messages: number }): Promise<void>;
    }) => {
      const result = { agentRuns: 20, messages: 2 };
      await hooks.afterRender(result);
      return result;
    });
    jest.mocked(findPiviView).mockReturnValue({
      leaf: {} as never,
      getChatHandle: () => ({
        commands: {} as PiviChatViewCommands,
        maintenance: {} as never,
        development: {
          run20AgentRunsWorkload,
          runIndexedSessionPagingWorkload: jest.fn(),
          run100KbMarkdownStream: jest.fn(),
          runTabSwitchingWorkload: jest.fn(),
        },
      }),
    });
    const { commands, perfController, plugin } = createPlugin();
    perfController.enabled = false;
    registerPiviCommands(plugin as never);

    commands.find(command => command.id === 'debug-run-20-agent-runs-workload')
      ?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(run20AgentRunsWorkload).toHaveBeenCalledTimes(1);
    expect(perfController.start).toHaveBeenCalledWith(
      'agent-runs-20-main-isolated',
      expect.anything(),
    );
    expect(perfController.stopAndExport).toHaveBeenCalledTimes(1);
  });

  it('runs the isolated tab switching workload through the mounted view', async () => {
    const runTabSwitchingWorkload = jest.fn(async () => ({
      tabs: 10,
      switches: 20,
      durationMs: 1_000,
    }));
    jest.mocked(findPiviView).mockReturnValue({
      leaf: {} as never,
      getChatHandle: () => ({
        commands: {} as PiviChatViewCommands,
        maintenance: {} as never,
        development: {
          run20AgentRunsWorkload: jest.fn(),
          runIndexedSessionPagingWorkload: jest.fn(),
          run100KbMarkdownStream: jest.fn(),
          runTabSwitchingWorkload,
        },
      }),
    });
    const { commands, plugin } = createPlugin();
    registerPiviCommands(plugin as never);

    commands.find(command => command.id === 'debug-run-tab-switching-workload')?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(runTabSwitchingWorkload).toHaveBeenCalledTimes(1);
  });

  it('exports isolated cold-open and older-page traces in one paging workload', async () => {
    const runIndexedSessionPagingWorkload = jest.fn(async (hooks: {
      afterColdOpen(): Promise<void>;
      afterOlderPage(): Promise<void>;
    }) => {
      await hooks.afterColdOpen();
      await hooks.afterOlderPage();
      return { initialMessages: 100, messagesAfterPrepend: 200 };
    });
    jest.mocked(findPiviView).mockReturnValue({
      leaf: {} as never,
      getChatHandle: () => ({
        commands: {} as PiviChatViewCommands,
        maintenance: {} as never,
        development: {
          run20AgentRunsWorkload: jest.fn(),
          runIndexedSessionPagingWorkload,
          run100KbMarkdownStream: jest.fn(),
          runTabSwitchingWorkload: jest.fn(),
        },
      }),
    });
    const { commands, perfController, plugin } = createPlugin();
    perfController.enabled = false;
    perfController.stopAndExport
      .mockResolvedValueOnce('.pivi/perf-traces/cold.json')
      .mockResolvedValueOnce('.pivi/perf-traces/older.json');
    registerPiviCommands(plugin as never);

    commands.find(command => command.id === 'debug-run-indexed-session-paging-workload')
      ?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(runIndexedSessionPagingWorkload).toHaveBeenCalledTimes(1);
    expect(perfController.start).toHaveBeenNthCalledWith(
      1,
      'indexed-cold-open-5k-main-isolated',
      expect.anything(),
    );
    expect(perfController.start).toHaveBeenNthCalledWith(
      2,
      'indexed-older-page-5k-main-isolated',
      expect.anything(),
    );
    expect(perfController.stopAndExport).toHaveBeenCalledTimes(2);
  });

  it('starts a CLI-safe trace from the optional vault scenario file', async () => {
    const { commands, perfController, plugin } = createPlugin();
    plugin.app.vault.adapter.exists.mockResolvedValue(true);
    plugin.app.vault.adapter.read.mockResolvedValue('5k-cold-open\n');
    registerPiviCommands(plugin as never);

    commands.find(command => command.id === 'debug-start-chat-performance-trace')?.callback?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(perfController.start).toHaveBeenCalledWith('5k-cold-open', expect.anything());
  });
});
