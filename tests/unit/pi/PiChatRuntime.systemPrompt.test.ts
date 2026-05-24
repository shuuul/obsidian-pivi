const mockAgentInstances: Array<{
  initialState: { systemPrompt: string; messages: unknown[] };
  state: { systemPrompt: string; messages: unknown[] };
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; messages: unknown[] };
  }) => {
    const instance = {
      initialState: options.initialState,
      state: { ...options.initialState },
      subscribe: jest.fn(() => () => {}),
      prompt: jest.fn().mockResolvedValue(undefined),
      abort: jest.fn(),
      reset: jest.fn(),
      sessionId: undefined,
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

import { PiChatRuntime } from '../../../src/pi/runtime/PiChatRuntime';

function createMockPlugin(overrides: {
  systemPrompt?: string;
  userName?: string;
  mediaFolder?: string;
} = {}): {
  settings: {
    model: string;
    systemPrompt: string;
    userName: string;
    mediaFolder: string;
    sharedEnvironmentVariables: string;
    agentSettings: {
      environmentVariables: string;
      visibleModels: string[];
    };
  };
  app: { vault: { adapter: { basePath: string } } };
} {
  return {
    settings: {
      model: 'anthropic/claude-sonnet-4-20250514',
      systemPrompt: overrides.systemPrompt ?? '',
      userName: overrides.userName ?? '',
      mediaFolder: overrides.mediaFolder ?? '',
      sharedEnvironmentVariables: '',
      agentSettings: {
        environmentVariables: 'ANTHROPIC_API_KEY=test-key',
        visibleModels: ['anthropic/claude-sonnet-4-20250514'],
      },
    },
    app: {
      vault: {
        adapter: {
          basePath: '/test/vault',
        },
      },
    },
  };
}

describe('PiChatRuntime system prompt', () => {
  beforeEach(() => {
    mockAgentInstances.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('initializes agent with buildSystemPrompt output', async () => {
    const plugin = createMockPlugin({ systemPrompt: 'Reply in Chinese.' });
    const runtime = new PiChatRuntime(plugin as never);

    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    const agent = mockAgentInstances[0];
    expect(agent.initialState.systemPrompt).toContain('You are **Obsius**');
    expect(agent.initialState.systemPrompt).toContain('## Custom Instructions');
    expect(agent.initialState.systemPrompt).toContain('Reply in Chinese.');
  });

  it('syncSystemPrompt hot-updates without recreating agent', async () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    await runtime.ensureReady();
    const firstAgent = mockAgentInstances[0];
    const initialMessages = [{ role: 'user', content: 'hello' }];
    firstAgent.state.messages = initialMessages;

    plugin.settings.systemPrompt = 'Use bullet lists.';
    await runtime.syncSystemPrompt();

    expect(mockAgentInstances).toHaveLength(1);
    expect(firstAgent.state.messages).toBe(initialMessages);
    expect(firstAgent.state.systemPrompt).toContain('Use bullet lists.');
  });

  it('ensureReady without force applies prompt changes without rebuild', async () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    await runtime.ensureReady();
    plugin.settings.userName = 'Alice';
    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].state.systemPrompt).toContain('**Alice**');
  });
});
