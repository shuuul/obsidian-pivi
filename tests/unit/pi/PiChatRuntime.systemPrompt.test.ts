const mockAgentInstances: Array<{
  initialState: { systemPrompt: string; messages: unknown[] };
  options: Record<string, unknown>;
  state: { systemPrompt: string; messages: unknown[] };
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; messages: unknown[] };
    [key: string]: unknown;
  }) => {
    const instance = {
      initialState: options.initialState,
      options,
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
  userName?: string;
} = {}): {
  settings: {
    model: string;
    userName: string;
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
      model: 'opencode-go/deepseek-v4-flash',
      userName: overrides.userName ?? '',
      sharedEnvironmentVariables: '',
      agentSettings: {
        environmentVariables: 'OPENCODE_API_KEY=test-key',
        visibleModels: ['opencode-go/deepseek-v4-flash'],
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
    process.env.OPENCODE_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
  });

  it('initializes agent with buildSystemPrompt output', async () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    await runtime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    const agent = mockAgentInstances[0];
    expect(agent.initialState.systemPrompt).toContain('You are **Pivi**');
    expect(agent.initialState.systemPrompt).not.toContain('## Custom Instructions');
    expect(agent.options).not.toHaveProperty('getApiKey');
  });

  it('syncSystemPrompt hot-updates without recreating agent', async () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    await runtime.ensureReady();
    const firstAgent = mockAgentInstances[0];
    const initialMessages = [{ role: 'user', content: 'hello' }];
    firstAgent.state.messages = initialMessages;

    plugin.settings.userName = 'Alice';
    await runtime.syncSystemPrompt();

    expect(mockAgentInstances).toHaveLength(1);
    expect(firstAgent.state.messages).toBe(initialMessages);
    expect(firstAgent.state.systemPrompt).toContain('**Alice**');
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

  it('persists session file and leaf id outside agentState', () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    runtime.syncOpenSessionState({
      sessionId: 'session-a',
      sessionFile: '.pivi/sessions/a.jsonl',
      leafId: 'leaf-a',
      agentState: { other: true },
    });

    const updates = runtime.buildSessionUpdates({
      openSession: null,
      sessionInvalidated: false,
    }).updates;

    expect(updates.agentState).toEqual({ other: true });
    expect(updates.agentState).not.toHaveProperty('piSessionFile');
    expect(updates).toMatchObject({
      agentState: { other: true },
      leafId: expect.any(String),
      sessionFile: expect.any(String),
      sessionId: expect.any(String),
    });
  });

  it('reads legacy piSessionFile from agentState but strips it from persisted updates', () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    runtime.syncOpenSessionState({
      sessionId: 'session-a',
      agentState: {
        piSessionFile: '.pivi/sessions/legacy.jsonl',
        other: true,
      },
    });

    const updates = runtime.buildSessionUpdates({
      openSession: null,
      sessionInvalidated: false,
    }).updates;

    expect(updates.agentState).toEqual({ other: true });
    expect(updates.agentState).not.toHaveProperty('piSessionFile');
    expect(updates.sessionFile).toEqual(expect.any(String));
  });
});
