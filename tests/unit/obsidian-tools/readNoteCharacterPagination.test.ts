import {
  createReadNoteTool,
  getLineSpans,
  OversizedFirstLineError,
  paginateCharacterRange,
  paginateLineRange,
  type ObsidianToolDeps,
} from '@pivi/obsidian-tools';

interface ReadResult {
  content: [{ text: string }];
  details: Record<string, unknown>;
}

function makeTool(
  content: string,
  availableChars = 50_000,
  settle: jest.Mock = jest.fn(),
): { tool: ReturnType<typeof createReadNoteTool>; readNote: jest.Mock; settle: jest.Mock } {
  const readNote = jest.fn().mockResolvedValue({ path: 'notes/long.md', content });
  const deps = {
    vault: { readNote },
    resolveReadMaxChars: () => ({ maxChars: availableChars, settle }),
  } as unknown as ObsidianToolDeps;
  return { tool: createReadNoteTool(deps), readNote, settle };
}

async function read(
  tool: ReturnType<typeof createReadNoteTool>,
  params: Record<string, unknown>,
): Promise<ReadResult> {
  return tool.execute('call', { path: 'notes/long.md', ...params }) as Promise<ReadResult>;
}

function sourceText(result: ReadResult): string {
  return result.content[0].text.split('\n\n[Read truncated:')[0] ?? '';
}

describe('obsidian_read character pagination', () => {
  it('sequentially reconstructs a 50K single physical line without overlap or gaps', async () => {
    const content = Array.from({ length: 50_321 }, (_, index) => String(index % 10)).join('');
    const { tool } = makeTool(content);
    const pages: string[] = [];
    let startChar = 1;
    let pageCount = 0;
    let finalDetails: Record<string, unknown> | undefined;

    while (true) {
      const result = await read(tool, { startChar, maxChars: 1_000 });
      pages.push(sourceText(result));
      pageCount += 1;
      expect(result.content[0].text.length).toBeLessThanOrEqual(1_000);
      if (result.details.truncated !== true) {
        finalDetails = result.details;
        break;
      }
      expect(result.content[0].text).toContain(`Continue with startChar=${String(result.details.nextStartChar)}`);
      startChar = result.details.nextStartChar as number;
      expect(pageCount).toBeLessThan(100);
    }

    expect(pageCount).toBeGreaterThan(50);
    expect(pages.join('')).toBe(content);
    expect(finalDetails).not.toHaveProperty('nextStartChar');
  });

  it('starts at a 1-based UTF-16 position and crosses physical lines', async () => {
    const prefix = 'ignored';
    const content = `${prefix}\n${'界'.repeat(400)}\n${'文'.repeat(1_200)}`;
    const { tool } = makeTool(content);

    const result = await read(tool, { startChar: prefix.length + 2, maxChars: 1_000 });

    expect(sourceText(result)).toMatch(/^界+/);
    expect(sourceText(result)).toContain('\n文');
    expect(sourceText(result)).not.toContain(prefix);
    expect(result.details).toMatchObject({
      startChar: prefix.length + 2,
      returnedStartChar: prefix.length + 2,
      truncated: true,
    });
    expect(result.details.nextStartChar).toBe((result.details.returnedEndChar as number) + 1);
  });

  it('returns a final page and an after-EOF page without continuation cursors', async () => {
    const { tool } = makeTool('abcdef');

    const finalPage = await read(tool, { startChar: 4, maxChars: 1_000 });
    const afterEof = await read(tool, { startChar: 99, maxChars: 1_000 });

    expect(finalPage.content[0].text).toBe('def');
    expect(finalPage.details).toMatchObject({
      returnedStartChar: 4,
      returnedEndChar: 6,
      truncated: false,
    });
    expect(finalPage.details).not.toHaveProperty('nextStartChar');
    expect(afterEof.content[0].text).toBe('');
    expect(afterEof.details).toMatchObject({ startChar: 99, truncated: false });
    expect(afterEof.details).not.toHaveProperty('returnedStartChar');
    expect(afterEof.details).not.toHaveProperty('returnedEndChar');
  });

  it('accepts line-relative character coordinates and rejects ambiguous or stats reads', async () => {
    const { tool, readNote } = makeTool('content');

    await expect(read(tool, { startChar: 1, startLine: 1 })).resolves.toMatchObject({
      content: [{ text: 'content' }],
      details: { characterCoordinate: 'line-relative' },
    });
    await expect(read(tool, { startChar: 1, endLine: 1 })).rejects.toThrow(
      'endLine with startChar requires startLine',
    );
    await expect(read(tool, { startChar: 1, mode: 'stats' })).rejects.toThrow(
      'startChar cannot be used with mode="stats"',
    );
    await expect(read(tool, { startChar: 0 })).rejects.toThrow('startChar must be a positive integer');
    expect(readNote).toHaveBeenCalledTimes(1);
  });

  it('treats startChar as relative to startLine and respects endLine', async () => {
    const content = 'first\nabcdef\nlast\nout-of-range';
    const { tool } = makeTool(content);

    const result = await read(tool, {
      startLine: 2,
      startChar: 3,
      endLine: 3,
      maxChars: 1_000,
    });

    expect(result.content[0].text).toBe('cdef\nlast\n');
    expect(result.details).toMatchObject({
      startLine: 2,
      startChar: 3,
      characterCoordinate: 'line-relative',
      returnedStartLine: 2,
      returnedStartChar: 3,
      returnedEndLine: 3,
      returnedEndChar: 5,
      truncated: false,
    });
    expect(result.details).not.toHaveProperty('nextStartLine');
    expect(result.details).not.toHaveProperty('nextStartChar');
  });

  it('continues line-relative pages with the exact returned line and character pair', async () => {
    const content = `skip\n${'a'.repeat(1_500)}\n${'界'.repeat(1_500)}\nstop`;
    const expected = `${'a'.repeat(1_500)}\n${'界'.repeat(1_500)}\n`;
    const { tool } = makeTool(content);
    const pages: string[] = [];
    let startLine = 2;
    let startChar = 1;

    while (true) {
      const result = await read(tool, {
        startLine,
        startChar,
        endLine: 3,
        maxChars: 1_000,
      });
      pages.push(sourceText(result));
      expect(result.content[0].text.length).toBeLessThanOrEqual(1_000);
      if (result.details.truncated !== true) break;
      expect(result.content[0].text).toContain(
        `Continue with startLine=${String(result.details.nextStartLine)}, startChar=${String(result.details.nextStartChar)}, endLine=3, maxChars=1000`,
      );
      startLine = result.details.nextStartLine as number;
      startChar = result.details.nextStartChar as number;
    }

    expect(pages.join('')).toBe(expected);
  });

  it('rejects a line-relative character beyond the selected physical line', async () => {
    const { tool } = makeTool('one\ntwo');

    await expect(read(tool, { startLine: 2, startChar: 4 })).rejects.toThrow(
      'startChar=4 is beyond physical line 2',
    );
  });

  it.each([
    ['low surrogate', 'A😀B', 3, 4],
    ['LF half of CRLF', 'A\r\nB', 3, 4],
  ])('rejects a startChar inside a %s with the next valid position', async (_label, content, startChar, next) => {
    const { tool } = makeTool(content);

    await expect(read(tool, { startChar, maxChars: 1_000 })).rejects.toThrow(
      `next valid position, startChar=${next}`,
    );
  });

  it.each([
    ['surrogate pair', '😀'],
    ['CRLF sequence', '\r\n'],
  ])('shortens a page instead of splitting a %s', async (_label, boundary) => {
    const baseline = await read(makeTool('x'.repeat(3_000)).tool, { startChar: 1, maxChars: 1_000 });
    const nominalEnd = baseline.details.returnedEndChar as number;
    const content = `${'x'.repeat(nominalEnd - 1)}${boundary}${'y'.repeat(3_000)}`;
    const { tool } = makeTool(content);

    const result = await read(tool, { startChar: 1, maxChars: 1_000 });

    expect(result.details.returnedEndChar).toBe(nominalEnd - 1);
    expect(sourceText(result)).toBe('x'.repeat(nominalEnd - 1));
    expect(result.details.nextStartChar).toBe(nominalEnd);
  });

  it('falls back from an oversized first selected line to character continuation', async () => {
    const content = `${'界'.repeat(50_000)}\nnext\n`;
    const { tool } = makeTool(content);

    const result = await read(tool, { startLine: 1, endLine: 2, maxChars: 1_000 });

    expect(result.content[0].text.length).toBeLessThanOrEqual(1_000);
    expect(sourceText(result)).toMatch(/^界+$/);
    expect(result.content[0].text).toContain('Continue with startLine=1, startChar=');
    expect(result.details).toMatchObject({
      requestedRange: { startLine: 1, endLine: 2 },
      characterCoordinate: 'line-relative',
      returnedStartLine: 1,
      returnedStartChar: 1,
      truncated: true,
    });
    expect(result.details).toHaveProperty('nextStartLine');
    expect(result.details).toHaveProperty('nextStartChar');
    expect(result.content[0].text).not.toContain('Raise maxChars');
  });

  it('bypasses stats-only large-file handling and settles the complete bounded result', async () => {
    const settle = jest.fn();
    const { tool } = makeTool('x'.repeat(60_000), 2_000, settle);

    const result = await read(tool, { startChar: 1, maxChars: 50_000 });

    expect(result.content[0].text).not.toContain('Large file: content was not returned');
    expect(result.content[0].text).toContain('maxChars=2000');
    expect(result.content[0].text.length).toBeLessThanOrEqual(2_000);
    expect(settle).toHaveBeenCalledWith(result.content[0].text.length);
  });

  it('documents character continuation on the registered ToolSpec', () => {
    const { tool } = makeTool('content');
    const properties = tool.parameters.properties as Record<string, { description?: string }>;

    expect(properties.startChar?.description).toContain('1-based UTF-16');
    expect(properties.startChar?.description).toContain('relative to startLine');
    expect(properties.startChar?.description).toContain('nextStartLine + nextStartChar');
    expect(tool.promptUsage?.summary).toContain('oversized physical line');
    expect(tool.promptUsage?.summary).toContain('nextStartLine + nextStartChar');
    expect(tool.promptUsage?.parameters).toContain('startChar');
  });
});

describe('read pagination error hints', () => {
  it('names startLine + startChar continuation when the first selected line cannot fit', () => {
    const content = `${'x'.repeat(200)}\nnext\n`;
    const spans = getLineSpans(content);
    let thrown: unknown;
    try {
      paginateLineRange(content, spans, 50, 1, 2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OversizedFirstLineError);
    const message = (thrown as Error).message;
    expect(message).toContain('Line 1 is 201 characters');
    expect(message).toContain('maxChars=50');
    expect(message).toContain('startLine=1');
    expect(message).toContain('startChar');
    expect(message).toContain('nextStartLine');
    expect(message).toContain('nextStartChar');
    expect(message).not.toContain('Raise maxChars');
  });

  it('keeps complete-line pagination when the first line fits the budget', () => {
    const content = Array.from({ length: 30 }, () => 'abcdefghij').join('\n') + '\n';
    const spans = getLineSpans(content);
    const page = paginateLineRange(content, spans, 200, 1, 30);

    expect(page.truncated).toBe(true);
    expect(page.returnedStartLine).toBe(1);
    expect(page.rawContent.startsWith('abcdefghij\n')).toBe(true);
    expect(page.nextStartLine).toBe((page.returnedEndLine ?? 0) + 1);
    expect(page.content).toContain(`Continue with startLine=${String(page.nextStartLine)}, endLine=30.`);
  });

  it('tells the caller to stop when one character plus the continuation marker cannot fit', () => {
    let thrown: unknown;
    try {
      paginateCharacterRange('abcdef', 1, 1);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('maxChars=1');
    expect(message).toContain('startChar=1');
    expect(message).toContain('Do not increase maxChars past the effective clamp');
    expect(message).toContain('stop rather than retry the identical call');
    expect(message).not.toContain('Raise maxChars');
  });
});
