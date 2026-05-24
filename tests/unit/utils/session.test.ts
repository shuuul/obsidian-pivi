import type { ChatMessage } from '../../../src/core/types';
import type { ToolCallInfo } from '../../../src/core/types/tools';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
  formatToolCallForContext,
  getLastUserMessage,
  isSessionExpiredError,
  truncateToolResult,
} from '../../../src/utils/session';

function userMsg(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'u1', role: 'user', content, timestamp: 1, ...extra };
}

function assistantMsg(content: string, toolCalls?: ToolCallInfo[]): ChatMessage {
  return { id: 'a1', role: 'assistant', content, timestamp: 2, toolCalls };
}

describe('session utils', () => {
  describe('isSessionExpiredError', () => {
    it('matches known session error phrases', () => {
      expect(isSessionExpiredError(new Error('Session expired'))).toBe(true);
      expect(isSessionExpiredError(new Error('invalid session id'))).toBe(true);
    });

    it('matches compound resume failure patterns', () => {
      expect(isSessionExpiredError(new Error('resume failed for id'))).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isSessionExpiredError(new Error('network timeout'))).toBe(false);
      expect(isSessionExpiredError('not an error')).toBe(false);
    });
  });

  describe('truncateToolResult', () => {
    it('truncates long strings with marker', () => {
      const long = 'x'.repeat(600);
      const out = truncateToolResult(long, 500);
      expect(out.length).toBeLessThan(long.length);
      expect(out).toContain('(truncated)');
    });

    it('returns short strings unchanged', () => {
      expect(truncateToolResult('ok')).toBe('ok');
    });
  });

  describe('formatToolCallForContext', () => {
    it('omits error body for completed tools', () => {
      const line = formatToolCallForContext({
        id: 't1',
        name: 'Read',
        input: { path: '/a.md' },
        status: 'completed',
      });
      expect(line).toContain('status=completed');
      expect(line).not.toContain('error:');
    });

    it('includes truncated error for failed tools', () => {
      const line = formatToolCallForContext({
        id: 't2',
        name: 'Bash',
        input: {},
        status: 'error',
        result: 'command failed',
      });
      expect(line).toContain('error: command failed');
    });
  });

  describe('buildContextFromHistory', () => {
    it('skips interrupt messages and empty assistant turns', () => {
      const context = buildContextFromHistory([
        userMsg('first'),
        { ...userMsg('interrupt'), isInterrupt: true },
        assistantMsg(''),
        assistantMsg('reply'),
      ]);

      expect(context).toContain('User: first');
      expect(context).not.toContain('interrupt');
      expect(context).toContain('Assistant: reply');
    });
  });

  describe('getLastUserMessage', () => {
    it('returns the last user message in order', () => {
      const last = getLastUserMessage([
        userMsg('one'),
        assistantMsg('two'),
        userMsg('three'),
      ]);
      expect(last?.content).toBe('three');
    });
  });

  describe('buildPromptWithHistoryContext', () => {
    it('appends prompt when it differs from last user query', () => {
      const history = buildContextFromHistory([userMsg('old question')]);
      const result = buildPromptWithHistoryContext(
        history,
        'new question',
        'new question',
        [userMsg('old question')],
      );

      expect(result).toContain('User: new question');
    });

    it('returns history only when prompt duplicates last user message', () => {
      const history = buildContextFromHistory([userMsg('same')]);
      const result = buildPromptWithHistoryContext(
        history,
        'same',
        'same',
        [userMsg('same')],
      );

      expect(result).toBe(history);
      expect(result).not.toContain('User: same\n\nUser:');
    });
  });
});
