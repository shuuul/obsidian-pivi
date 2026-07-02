const mockAgentInstances: Array<{
  initialState: { systemPrompt: string; messages: unknown[] };
  options: Record<string, unknown>;
  state: { systemPrompt: string; messages: unknown[] };
  listeners: Array<(event: any) => void>;
  prompt: jest.Mock;
}> = [];

jest.mock('@earendil-works/pi-agent-core', () => ({
  Agent: jest.fn().mockImplementation((options: {
    initialState: { systemPrompt: string; messages: unknown[] };
    [key: string]: unknown;
  }) => {
    const listeners: Array<(event: any) => void> = [];
    const instance = {
      initialState: options.initialState,
      options,
      state: { ...options.initialState },
      listeners,
      subscribe: jest.fn((listener: (event: any) => void) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      }),
      prompt: jest.fn(async (input: string) => {
        instance.state.messages = [
          { role: 'user', content: input },
          { role: 'assistant', content: 'Hello' },
        ];
        for (const listener of [...listeners]) {
          listener({ type: 'turn_start' });
          listener({ type: 'message_end', message: { role: 'user', content: input } });
          listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
          listener({
            type: 'message_update',
            message: {} as any,
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} as any },
          });
          listener({ type: 'message_end', message: { role: 'assistant', content: 'Hello' } });
          listener({ type: 'agent_end', messages: [] });
        }
      }),
      abort: jest.fn(),
      reset: jest.fn(),
      sessionId: undefined,
    };
    mockAgentInstances.push(instance);
    return instance;
  }),
}));

import { PiChatRuntime } from '@pivi/pi-runtime/PiChatRuntime';

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

  it('persists session file without exposing legacy leaf id in session state updates', () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    runtime.syncSession({ sessionFile: '.pivi/sessions/a.jsonl', leafId: 'entry-1' });

    const updates = runtime.getSessionStateUpdates();

    expect(updates.agentState).toBeUndefined();
    expect(updates).toMatchObject({
      sessionFile: expect.any(String),
      sessionId: expect.any(String),
    });
    expect(updates.leafId).toBeUndefined();
  });

  it('resumes from an explicit session file binding', () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    runtime.syncSession({ sessionFile: '.pivi/sessions/legacy.jsonl' });

    const updates = runtime.getSessionStateUpdates();

    expect(updates.agentState).toBeUndefined();
    expect(updates.sessionFile).toEqual(expect.any(String));
  });

  it('streams adapted chunks from query and sends the prepared prompt to the agent', async () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);
    const turn = runtime.prepareTurn({ text: 'Hi Pi' });

    const chunks = [];
    for await (const chunk of runtime.query(turn)) {
      chunks.push(chunk);
    }

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].prompt).toHaveBeenCalledWith('Hi Pi');
    expect(chunks).toEqual([
      { type: 'assistant_message_start' },
      { type: 'text', content: 'Hello' },
      { type: 'done' },
    ]);
  });

  it('resumes with persisted session messages when a session file is already open', async () => {
    const plugin = createMockPlugin();
    const seedRuntime = new PiChatRuntime(plugin as never);
    const seedTurn = seedRuntime.prepareTurn({ text: 'Earlier user message' });
    for await (const _chunk of seedRuntime.query(seedTurn)) {
      // Drain the stream so the in-memory session tree records the turn.
    }
    const seedUpdates = seedRuntime.getSessionStateUpdates();
    mockAgentInstances.length = 0;

    const resumedRuntime = new PiChatRuntime(plugin as never);
    resumedRuntime.syncSession({ sessionFile: seedUpdates.sessionFile ?? null });
    await resumedRuntime.ensureReady();

    expect(mockAgentInstances).toHaveLength(1);
    expect(mockAgentInstances[0].initialState.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'Earlier user message' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    ]));
  });

  it('getSessionStateUpdates returns current session binding when no session has been created', () => {
    const plugin = createMockPlugin();
    const runtime = new PiChatRuntime(plugin as never);

    runtime.syncSession({ sessionFile: null, leafId: null });

    const updates = runtime.getSessionStateUpdates();

    expect(updates).toEqual({
      sessionId: null,
      sessionFile: undefined,
      agentState: undefined,
    });
  });
});
