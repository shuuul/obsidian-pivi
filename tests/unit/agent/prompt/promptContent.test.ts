import {
  buildRegisteredToolsSection,
  buildSystemPrompt,
} from '@pivi/agent/prompt';
import type { ToolSpec } from '@pivi/agent/tools';

function spec(
  name: string,
  promptUsage?: ToolSpec['promptUsage'],
): ToolSpec {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
    promptUsage,
    async execute() {},
  };
}

describe('failure-driven prompt content', () => {
  it('includes locked recovery and rewrite-integrity rules in the default static prompt', () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain('## Tool failure recovery');
    expect(prompt).toContain('Never re-send an identical failing tool call');
    expect(prompt).toContain('Do not stop silently and wait for the user to type continue');
    expect(prompt).toContain('Copy `old_string` verbatim from the latest read output');
    expect(prompt).toContain('do not reconstruct it from memory');
    expect(prompt).toContain('Do not introduce quotes or facts that are absent from the source');
    expect(prompt).toContain('do not create draft or sibling copies such as ` (draft).md`');
    expect(prompt).not.toContain('`sentence.Second`');
    expect(prompt).not.toContain('replacing only `Target` with `### Heading`');
  });

  it('keeps search-not-read on the search promptUsage owner', () => {
    const search = spec('obsidian_search', {
      summary: 'Use search to locate notes and match positions, never as a content-read backdoor: `context: true` dumps are not a substitute for reading note bodies.',
      parameters: '`query`',
    });
    const section = buildRegisteredToolsSection({
      obsidianTools: ['obsidian_search'],
      toolSpecs: [search],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: false,
      includeSubagent: false,
      includeWebSearch: false,
    });

    expect(section).toContain('never as a content-read backdoor');
    expect(section).toContain('`context: true` dumps are not a substitute for reading note bodies');
    expect(buildSystemPrompt()).not.toContain('content-read backdoor');
  });

  it('keeps stats-first paging, clamp continuation, and coordinate exclusivity on registered read guidance', () => {
    const section = buildRegisteredToolsSection({
      obsidianTools: ['obsidian_read'],
      toolSpecs: [spec('obsidian_read')],
      obsidianCliAvailable: true,
      includeMcp: false,
      includeSkill: false,
      includeSubagent: false,
      includeWebSearch: false,
    });
    const prompt = buildSystemPrompt({}, {
      registeredToolNames: ['obsidian_read'],
      registeredToolsSection: section,
    });

    expect(section).toContain('Do not raise `maxChars` past the effective clamp');
    expect(section).toContain('Plan page size from `mode: "stats"`');
    expect(section).toContain('tiny `startChar` steps of around 800 characters');
    expect(section).toContain('These coordinate systems are mutually exclusive per call');
    expect(prompt).toContain('Do not raise `maxChars` past the effective clamp');
    expect(prompt).toContain('These coordinate systems are mutually exclusive per call');
  });
});
