import {
  remindCanonicalToolForm,
  toPiAgentTool,
  wrapStreamFnToHideAliasTools,
} from '@pivi/engine-pi/tools/piToolAdapter';
import type { ToolSpec } from '@pivi/agent/tools';

describe('remindCanonicalToolForm', () => {
  it('appends a field-alias reminder from the raw tool-call arguments', async () => {
    const result = await remindCanonicalToolForm({
      isError: false,
      toolCall: { name: 'read', arguments: { file_path: 'a.md' } },
      result: { content: [{ type: 'text', text: 'ok' }], details: {} },
    } as never);

    expect(result?.content).toEqual([
      { type: 'text', text: 'ok\n\nUse the canonical field `path` next time.' },
    ]);
  });

  it('skips reminders on errors', async () => {
    await expect(remindCanonicalToolForm({
      isError: true,
      toolCall: { name: 'obsidian_read', arguments: { path: 'a.md' } },
      result: { content: [{ type: 'text', text: 'fail' }], details: {} },
    } as never)).resolves.toBeUndefined();
  });
});

describe('toPiAgentTool prepareArguments', () => {
  it('normalizes field aliases before execute', () => {
    const spec: ToolSpec = {
      name: 'read',
      description: 'Read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return { content: [{ type: 'text', text: 'ok' }], details: {} };
      },
    };
    const tool = toPiAgentTool(spec);
    expect(tool.prepareArguments?.({ file_path: 'a.md', startLine: 2, endLine: 4 })).toEqual({
      path: 'a.md',
      offset: 2,
      limit: 3,
    });
  });
});

describe('wrapStreamFnToHideAliasTools', () => {
  const live = { name: 'read', description: 'Read', parameters: {} };
  const alias = { name: 'obsidian_read', description: 'Read', parameters: {} };
  const user = { role: 'user', content: 'hi', timestamp: 1 };

  it('rebuilds the leading system message without silent alias declarations', () => {
    const streamFn = jest.fn();
    const context = {
      messages: [
        { role: 'system', content: 'prompt', toolsAdded: [live, alias], timestamp: 0 },
        user,
      ],
    };

    void wrapStreamFnToHideAliasTools(streamFn as never)({} as never, context as never, undefined);

    expect(streamFn.mock.calls[0][1]).toEqual({
      messages: [
        { role: 'system', content: 'prompt', toolsAdded: [live], timestamp: 0 },
        user,
      ],
    });
  });

  it('passes the transcript through untouched when no alias is declared', () => {
    const streamFn = jest.fn();
    const context = {
      messages: [{ role: 'system', content: 'prompt', toolsAdded: [live], timestamp: 0 }, user],
    };

    void wrapStreamFnToHideAliasTools(streamFn as never)({} as never, context as never, undefined);

    expect(streamFn.mock.calls[0][1]).toBe(context);
  });
});
