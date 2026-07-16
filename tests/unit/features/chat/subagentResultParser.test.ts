import { SubagentResultParser } from '@/ui/chat/services/SubagentResultParser';
import { AGENT_REPORT_BLOCK_LANGUAGE } from '@pivi/pivi-agent-core/session/continuationSchemas';
import type { TaskResultInterpreter } from '@pivi/pivi-agent-core/tools';

const mockInterpreter: TaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (_result, fallback) => fallback,
  extractTagValue: (payload, tag) => {
    const match = payload.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) return null;
    const value = match[1];
    if (value === undefined) return null;
    return value.trim();
  },
};

describe('SubagentResultParser', () => {
  let parser: SubagentResultParser;

  beforeEach(() => {
    parser = new SubagentResultParser(mockInterpreter);
  });

  describe('extractAgentId', () => {
    it('returns agentId for exact line match', () => {
      expect(parser.extractAgentId('agent_id = my-agent-123')).toBe('my-agent-123');
      expect(parser.extractAgentId('agentId: "my-agent-456"')).toBe('my-agent-456');
    });

    it('returns agentId from JSON record', () => {
      const json = JSON.stringify({
        task: {
          agent_id: 'json-agent-789'
        }
      });
      expect(parser.extractAgentId(json)).toBe('json-agent-789');
    });

    it('returns null if terminal status is present', () => {
      const json = JSON.stringify({
        status: 'completed',
        task: {
          agent_id: 'json-agent-789'
        }
      });
      expect(parser.extractAgentId(json)).toBeNull();
    });

    it('returns null if XML status is terminal', () => {
      const xml = '<status>completed</status> agent_id = test';
      expect(parser.extractAgentId(xml)).toBeNull();
    });
  });

  describe('isStillRunningResult', () => {
    it('returns false if isError is true', () => {
      expect(parser.isStillRunningResult('running', true)).toBe(false);
    });

    it('returns true if status is not_ready or running', () => {
      const json = JSON.stringify({ status: 'running' });
      expect(parser.isStillRunningResult(json, false)).toBe(true);
    });

    it('returns false if status is success or completed', () => {
      const json = JSON.stringify({ status: 'success' });
      expect(parser.isStillRunningResult(json, false)).toBe(false);
    });

    it('detects running agents in nested object', () => {
      const json = JSON.stringify({
        agents: {
          agent1: { status: 'running' }
        }
      });
      expect(parser.isStillRunningResult(json, false)).toBe(true);
    });

    it('detects running status in XML', () => {
      expect(parser.isStillRunningResult('<status>running</status>', false)).toBe(true);
    });
  });

  describe('extractAgentResult', () => {
    it('prefers the preserved terminal result over compact parent-model content', () => {
      expect(parser.extractAgentResult('compact report', 'agent1', {
        terminal_result: 'full terminal narrative',
        agent_report: { schemaVersion: 1, objective: 'Audit', outcome: 'completed' },
      })).toBe('full terminal narrative');
    });

    it('removes the internal report fence from the preserved terminal result', () => {
      expect(parser.extractAgentResult('compact report', 'agent1', {
        terminal_result: [
          'Visible narrative.',
          `\`\`\`${AGENT_REPORT_BLOCK_LANGUAGE}`,
          '{"schemaVersion":1,"objective":"Audit","outcome":"completed"}',
          '```',
        ].join('\n'),
      })).toBe('Visible narrative.');
    });

    it('extracts result from task object', () => {
      const json = JSON.stringify({
        task: {
          result: 'task successful'
        }
      });
      expect(parser.extractAgentResult(json, 'agent1')).toBe('task successful');
    });

    it('extracts result from agentData matching agentId', () => {
      const json = JSON.stringify({
        agents: {
          agent1: { result: 'agent1 result' },
          agent2: { result: 'agent2 result' }
        }
      });
      expect(parser.extractAgentResult(json, 'agent1')).toBe('agent1 result');
    });

    it('does not stringify protocol wrappers without a textual result', () => {
      const json = JSON.stringify({
        agents: {
          agent1: { status: 'completed', metadata: { internal: true } },
        },
      });
      expect(parser.extractAgentResult(json, 'agent1')).toBe('');
    });

    it('falls back to tagged result', () => {
      const payload = '<result>tagged output</result>';
      expect(parser.extractAgentResult(payload, 'agent1')).toBe('tagged output');
    });
  });
});
