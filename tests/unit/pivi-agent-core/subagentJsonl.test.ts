import {
  extractAgentReportFromSubagentJsonl,
  extractFinalResultFromSubagentJsonl,
} from '@pivi/pivi-agent-core/session/subagentJsonl';
import { createAgentReportBlock } from '../../helpers/agentReport';

describe('subagent JSONL compatibility', () => {
  it('extracts a structured report from the latest assistant text', () => {
    const report = {
      schemaVersion: 1 as const,
      objective: 'Inspect notes',
      outcome: 'completed' as const,
      summary: 'Done',
    };
    const text = `Narrative.\n${createAgentReportBlock(report)}`;
    const content = [
      '{malformed',
      JSON.stringify({ result: 'older result' }),
      JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text }] } }),
    ].join('\n');

    expect(extractFinalResultFromSubagentJsonl(content)).toBe(text);
    expect(extractAgentReportFromSubagentJsonl(content)).toEqual(report);
  });

  it('keeps plain and malformed terminal output on the text-only path', () => {
    const content = JSON.stringify({ result: 'plain result' });
    expect(extractFinalResultFromSubagentJsonl(content)).toBe('plain result');
    expect(extractAgentReportFromSubagentJsonl(content)).toBeNull();
  });
});
