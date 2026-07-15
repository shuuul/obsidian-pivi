import type { ChatMessage } from '@pivi/pivi-agent-core/foundation';
import type { ChatProjectionEvent } from '@pivi/pivi-react/store';
import { ChatState } from '@/ui/chat/state/ChatState';

function userMessage(id: string, content = 'hello'): ChatMessage {
  return { id, role: 'user', content, timestamp: Date.now() };
}

describe('ChatState', () => {
  it('starts with empty messages and no streaming', () => {
    const state = new ChatState();
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.currentOpenSessionId).toBeNull();
    expect(state.uiStore.getSnapshot()).toMatchObject({
      isStreaming: false,
      currentOpenSessionId: null,
    });
    expect(state.projectionStore.getOrderSnapshot()).toEqual([]);
  });

  it('publishes a cloneable UI snapshot without runtime presentation state', () => {
    const state = new ChatState();
    expect(structuredClone(state.uiStore.getSnapshot())).toEqual(state.uiStore.getSnapshot());
  });

  describe('messages', () => {
    it('routes subagent, agent, and tool ownership through maintained indexes', () => {
      const state = new ChatState();
      const owner: ChatMessage = {
        id: 'assistant-owner',
        role: 'assistant',
        content: '',
        timestamp: 1,
        contentBlocks: [{ type: 'subagent', subagentId: 'subagent-1' }],
        toolCalls: [{
          id: 'tool-1',
          name: 'Task',
          input: {},
          status: 'running',
          subagent: {
            id: 'subagent-1',
            agentId: 'agent-1',
            description: 'Research',
            isExpanded: false,
            status: 'running',
            toolCalls: [],
          },
        }],
      };
      state.addMessage(owner);

      expect(state.findOwnerMessage({ subagentId: 'subagent-1' })).toBe(owner);
      expect(state.findOwnerMessage({ agentId: 'agent-1' })).toBe(owner);
      expect(state.findOwnerMessage({ toolId: 'tool-1' })).toBe(owner);
      state.clearMessages();
      expect(state.findOwnerMessage({ agentId: 'agent-1' })).toBeNull();
    });

    it('indexes 20 background agent owners independently', () => {
      const state = new ChatState();
      for (let index = 0; index < 20; index += 1) {
        state.addMessage({
          id: `assistant-${index}`,
          role: 'assistant',
          content: '',
          timestamp: index,
          toolCalls: [{
            id: `tool-${index}`,
            name: 'spawn_agent',
            input: {},
            status: 'running',
            subagent: {
              id: `subagent-${index}`,
              agentId: `agent-${index}`,
              description: `Agent ${index}`,
              isExpanded: false,
              status: 'running',
              toolCalls: [],
            },
          }],
        });
      }

      expect(state.findOwnerMessage({ agentId: 'agent-0' })?.id).toBe('assistant-0');
      expect(state.findOwnerMessage({ agentId: 'agent-19' })?.id).toBe('assistant-19');
    });


    it('addMessage appends messages and publishes the UI snapshot', () => {
      const state = new ChatState();

      state.addMessage(userMessage('1'));
      state.addMessage(userMessage('2'));

      expect(state.messages).toHaveLength(2);
      expect(state.projectionStore.getOrderSnapshot()).toHaveLength(2);
    });

    it('clearMessages removes all messages', () => {
      const state = new ChatState();
      state.addMessage(userMessage('1'));

      state.clearMessages();

      expect(state.messages).toEqual([]);
      expect(state.projectionStore.getOrderSnapshot()).toEqual([]);
    });

    it('truncateAt removes messages from id onward', () => {
      const state = new ChatState();
      state.addMessage(userMessage('a'));
      state.addMessage(userMessage('b'));
      state.addMessage(userMessage('c'));

      const removed = state.truncateAt('b');

      expect(removed).toBe(2);
      expect(state.messages.map((m) => m.id)).toEqual(['a']);
    });

    it('truncateAt returns 0 when id is missing', () => {
      const state = new ChatState();
      state.addMessage(userMessage('a'));

      expect(state.truncateAt('missing')).toBe(0);
      expect(state.messages).toHaveLength(1);
    });

    it('messages getter returns a shallow copy', () => {
      const state = new ChatState();
      state.addMessage(userMessage('1'));
      const copy = state.messages;
      copy.push(userMessage('2'));
      expect(state.messages).toHaveLength(1);
    });
  });

  describe('streaming', () => {
    it('publishes typed causes with producer-owned ownership and sequence metadata', () => {
      let sessionFile: string | null = null;
      let timestamp = 100;
      const state = new ChatState({}, undefined, {
        projectionScopeId: 'tab-1',
        getSessionFile: () => sessionFile,
        now: () => timestamp++,
      });
      const dispatch = jest.spyOn(state.projectionStore, 'dispatch');
      const message: ChatMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
      };

      state.addMessage(message);
      state.bumpStreamGeneration();
      message.content = 'hello';
      message.contentBlocks = [{ type: 'text', content: 'hello' }];
      state.notifyMessageChanged(message, {
        type: 'text.append',
        blockId: 'assistant-1:block:0',
        delta: 'hello',
      });
      state.flushProjection();

      const events = dispatch.mock.calls.map(([event]) => event as ChatProjectionEvent);
      expect(events.map(event => event.type)).toEqual([
        'message.upsert',
        'text.append',
        'projection.flush',
      ]);
      expect(events.map(event => event.sequence)).toEqual([1, 2, 3]);
      expect(events[1]).toMatchObject({
        projectionScopeId: 'tab-1',
        sessionFile: null,
        openSessionId: null,
        runId: 'tab-1:run:1',
        parentRunId: null,
        messageId: 'assistant-1',
        blockId: 'assistant-1:block:0',
        toolId: null,
        agentId: null,
        timestamp: 101,
        delta: 'hello',
      });

      sessionFile = '.pivi/sessions/one.jsonl';
      state.currentOpenSessionId = 'open-1';
      state.notifyMessageChanged(message);
      const rebound = dispatch.mock.calls.at(-1)?.[0] as ChatProjectionEvent;
      expect(rebound).toMatchObject({
        sessionFile: '.pivi/sessions/one.jsonl',
        openSessionId: 'open-1',
        sequence: 1,
      });
    });

    it('publishes tool and Agent causes with entity and child-run ownership', () => {
      const state = new ChatState({}, undefined, { projectionScopeId: 'tab-2' });
      state.bumpStreamGeneration();
      const agent = {
        id: 'subagent-1',
        agentId: 'agent-1',
        description: 'Research',
        isExpanded: false,
        status: 'running' as const,
        toolCalls: [],
      };
      const tool = {
        id: 'tool-1',
        name: 'spawn_agent',
        input: {},
        status: 'running' as const,
        subagent: agent,
      };
      const message: ChatMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [tool],
      };
      state.messages = [message];
      const dispatch = jest.spyOn(state.projectionStore, 'dispatch');

      state.notifyMessageChanged(message, { type: 'tool.upsert', tool });
      state.notifyMessageChanged(
        message,
        { type: 'agent.upsert', agent },
        { childRunId: 'agent-1' },
      );

      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        type: 'tool.upsert',
        toolId: 'tool-1',
        agentId: null,
        runId: 'tab-2:run:1',
      });
      expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
        type: 'agent.upsert',
        toolId: null,
        agentId: 'agent-1',
        runId: 'tab-2:run:1:agent:agent-1',
        parentRunId: 'tab-2:run:1',
      });
    });

    it('publishes one snapshot after projecting and applying a stream chunk', () => {
      const state = new ChatState();
      const message: ChatMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
      };
      state.messages = [message];
      const listener = jest.fn();
      state.projectionStore.subscribeMessage(message.id, listener);

      state.projectStreamChunk(message, { type: 'text', content: 'hello' });
      expect(listener).not.toHaveBeenCalled();
      state.notifyMessageChanged(message);
      state.flushProjection();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(state.projectionStore.getMessageSnapshot(message.id)?.content).toBe('hello');
    });

    it('updates durable and attention state immediately while projection is hidden', () => {
      const ownerWindow = {
        document: {
          visibilityState: 'hidden',
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        },
        requestAnimationFrame: jest.fn(),
        cancelAnimationFrame: jest.fn(),
        setTimeout: jest.fn(() => 1),
        clearTimeout: jest.fn(),
      } as unknown as Window;
      const state = new ChatState();
      const message: ChatMessage = {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
      };
      state.addMessage(message);
      state.projectionStore.setOwnerWindow(ownerWindow);

      state.projectStreamChunk(message, { type: 'text', content: 'durable' });
      state.notifyMessageChanged(message);
      state.needsAttention = true;

      expect(state.messages[0]?.content).toBe('durable');
      expect(state.projectionStore.getMessageSnapshot(message.id)?.content).toBe('');
      expect(state.uiStore.getSnapshot().needsAttention).toBe(true);
      expect(ownerWindow.setTimeout).toHaveBeenCalledTimes(1);
    });

    it('isStreaming setter invokes onStreamingStateChanged', () => {
      const onStreamingStateChanged = jest.fn();
      const state = new ChatState({ onStreamingStateChanged });

      state.isStreaming = true;
      state.isStreaming = false;

      expect(onStreamingStateChanged).toHaveBeenNthCalledWith(1, true);
      expect(onStreamingStateChanged).toHaveBeenNthCalledWith(2, false);
    });

    it('bumpStreamGeneration increments counter', () => {
      const state = new ChatState();
      expect(state.streamGeneration).toBe(0);
      expect(state.bumpStreamGeneration()).toBe(1);
      expect(state.bumpStreamGeneration()).toBe(2);
    });

    it('resetStreamingState clears streaming fields without publishing text accumulation', () => {
      const state = new ChatState();
      state.isStreaming = true;
      state.cancelRequested = true;
      state.currentTextContent = 'partial';

      state.resetStreamingState();

      expect(state.isStreaming).toBe(false);
      expect(state.cancelRequested).toBe(false);
      expect(state.currentTextContent).toBe('');
      expect(state.uiStore.getSnapshot()).not.toHaveProperty('currentTextContent');
    });
  });

  describe('openSession id', () => {
    it('currentOpenSessionId setter fires onOpenSessionChanged', () => {
      const onOpenSessionChanged = jest.fn();
      const state = new ChatState({ onOpenSessionChanged });

      state.currentOpenSessionId = 'conv-1';

      expect(onOpenSessionChanged).toHaveBeenCalledWith('conv-1');
      expect(state.uiStore.getSnapshot().currentOpenSessionId).toBe('conv-1');
    });
  });

  describe('todos', () => {
    it('normalizes empty todo arrays to null and publishes visualization only', () => {
      const state = new ChatState();

      state.currentTodos = [];

      expect(state.currentTodos).toBeNull();
      expect(state.uiStore.getSnapshot().currentTodoVisualizationModel).toBeNull();
      expect(state.uiStore.getSnapshot()).not.toHaveProperty('currentTodos');
    });
  });

  describe('autoScroll', () => {
    it('autoScrollEnabled publishes only when value changes', () => {
      const state = new ChatState();

      state.autoScrollEnabled = true;
      state.autoScrollEnabled = false;

      expect(state.uiStore.getSnapshot().autoScrollEnabled).toBe(false);
    });
  });

  describe('resetForNewSession', () => {
    it('clears messages, streaming state, and usage', () => {
      const state = new ChatState();
      state.addMessage(userMessage('1'));
      state.isStreaming = true;
      state.usage = {
        inputTokens: 1,
        contextWindow: 100_000,
        contextTokens: 1,
        percentage: 0.001,
      };

      state.resetForNewSession();

      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.usage).toBeNull();
    });
  });
});
