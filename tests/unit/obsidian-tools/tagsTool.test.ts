import { createTagsTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(): ObsidianToolDeps {
  return {
    vault: {
      getTags: jest.fn().mockReturnValue(
        Array.from({ length: 4_000 }, (_, index) => ({
          name: `tag-${index}-${'x'.repeat(40)}`,
          count: index,
        })),
      ),
    },
  } as never;
}

describe('createTagsTool', () => {
  it('caps a vault-wide tag list before it becomes model-visible text', async () => {
    const deps = makeDeps();
    const tool = createTagsTool(deps);

    const result = await tool.execute('call', { action: 'list' }) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content[0]?.text ?? '';

    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text).toContain('[tags list truncated to 50000 characters]');
  });
});
