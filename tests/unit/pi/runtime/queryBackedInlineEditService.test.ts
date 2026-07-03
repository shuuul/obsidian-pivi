import { QueryBackedInlineEditService } from '@pivi/pivi-agent-core/runtime/queryBackedInlineEditService';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';

function createRunner(response: string): AuxQueryRunner & { query: jest.Mock; reset: jest.Mock } {
  return {
    query: jest.fn(async () => response),
    reset: jest.fn(),
  };
}

describe('QueryBackedInlineEditService', () => {
  it('resets session, sends inline edit prompt, and parses replacements', async () => {
    const runner = createRunner('<replacement>updated text</replacement>');
    const service = new QueryBackedInlineEditService(runner);

    const result = await service.editText({
      mode: 'selection',
      instruction: 'Improve this',
      notePath: 'notes/example.md',
      selectedText: 'old text',
    });

    expect(runner.reset).toHaveBeenCalledTimes(1);
    expect(runner.query).toHaveBeenCalledWith(
      expect.objectContaining({
        abortController: expect.any(AbortController),
        systemPrompt: expect.stringContaining('You are **Pivi**'),
      }),
      expect.stringContaining('<editor_selection path="notes/example.md">\nold text\n</editor_selection>'),
    );
    expect(result).toEqual({ success: true, editedText: 'updated text' });
  });

  it('continues only after an edit session is open and applies model overrides', async () => {
    const runner = createRunner('<insertion>more text</insertion>');
    const service = new QueryBackedInlineEditService(runner);

    await expect(service.continueSession('continue')).resolves.toEqual({
      success: false,
      error: 'No active session to continue',
    });

    service.setModelOverride(' anthropic/test ');
    await service.editText({
      mode: 'cursor',
      instruction: 'Add text',
      notePath: 'notes/example.md',
      cursorContext: {
        line: 0,
        column: 6,
        beforeCursor: 'before',
        afterCursor: 'after',
        isInbetween: false,
      },
    });

    const continued = await service.continueSession('continue', ['notes/context.md']);

    expect(runner.query).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'anthropic/test' }),
      expect.stringContaining('<context_files>'),
    );
    expect(continued).toEqual({ success: true, insertedText: 'more text' });
  });
});
