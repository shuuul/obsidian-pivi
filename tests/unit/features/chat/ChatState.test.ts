import type { ChatMessage } from '../../../../src/pi/types';
import { ChatState } from '../../../../src/features/chat/state/ChatState';

function userMessage(id: string, content = 'hello'): ChatMessage {
  return { id, role: 'user', content, timestamp: Date.now() };
}

describe('ChatState', () => {
  it('starts with empty messages and no streaming', () => {
    const state = new ChatState();
    expect(state.messages).toEqual([]);
    expect(state.isStreaming).toBe(false);
    expect(state.currentOpenSessionId).toBeNull();
  });

  describe('messages', () => {
    it('addMessage appends and notifies onMessagesChanged', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });

      state.addMessage(userMessage('1'));
      state.addMessage(userMessage('2'));

      expect(state.messages).toHaveLength(2);
      expect(onMessagesChanged).toHaveBeenCalledTimes(2);
    });

    it('clearMessages removes all messages', () => {
      const onMessagesChanged = jest.fn();
      const state = new ChatState({ onMessagesChanged });
      state.addMessage(userMessage('1'));

      state.clearMessages();

      expect(state.messages).toEqual([]);
      expect(onMessagesChanged).toHaveBeenCalledTimes(2);
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

    it('resetStreamingState clears streaming DOM fields', () => {
      const state = new ChatState();
      state.isStreaming = true;
      state.cancelRequested = true;
      state.currentTextContent = 'partial';

      state.resetStreamingState();

      expect(state.isStreaming).toBe(false);
      expect(state.cancelRequested).toBe(false);
      expect(state.currentTextContent).toBe('');
    });
  });

  describe('openSession id', () => {
    it('currentOpenSessionId setter fires onOpenSessionChanged', () => {
      const onOpenSessionChanged = jest.fn();
      const state = new ChatState({ onOpenSessionChanged });

      state.currentOpenSessionId = 'conv-1';

      expect(onOpenSessionChanged).toHaveBeenCalledWith('conv-1');
    });
  });

  describe('todos', () => {
    it('normalizes empty todo arrays to null', () => {
      const onTodosChanged = jest.fn();
      const state = new ChatState({ onTodosChanged });

      state.currentTodos = [];

      expect(state.currentTodos).toBeNull();
      expect(onTodosChanged).toHaveBeenCalledWith(null);
    });
  });

  describe('autoScroll', () => {
    it('onAutoScrollChanged fires only when value changes', () => {
      const onAutoScrollChanged = jest.fn();
      const state = new ChatState({ onAutoScrollChanged });

      state.autoScrollEnabled = true;
      state.autoScrollEnabled = false;

      expect(onAutoScrollChanged).toHaveBeenCalledTimes(1);
      expect(onAutoScrollChanged).toHaveBeenCalledWith(false);
    });
  });

  describe('resetForNewSession', () => {
    it('clears messages, streaming state, maps, and usage', () => {
      const state = new ChatState();
      state.addMessage(userMessage('1'));
      state.isStreaming = true;
      state.usage = {
        inputTokens: 1,
        contextWindow: 100_000,
        contextTokens: 1,
        percentage: 0.001,
      };
      state.pendingTools.set('t1', {
        toolCall: { id: 't1', name: 'Read', input: {}, status: 'running' },
        parentEl: null,
      });

      state.resetForNewSession();

      expect(state.messages).toEqual([]);
      expect(state.isStreaming).toBe(false);
      expect(state.usage).toBeNull();
      expect(state.pendingTools.size).toBe(0);
    });
  });
});
