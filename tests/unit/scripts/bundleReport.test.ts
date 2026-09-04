import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();

function report(baseBytes: number, currentBytes: number, currentInputs: Record<string, number>) {
  const inputMap = (inputs: Record<string, number>) => Object.fromEntries(
    Object.entries(inputs).map(([name, bytesInOutput]) => [name, { bytesInOutput }]),
  );
  const baseInputs = { 'src/a.ts': 100, 'src/b.ts': 50 };
  const code = `
    import { createBundleReport } from './scripts/bundle-report.mjs';
    const result = createBundleReport({
      baseMetafile: { outputs: { 'main.js': { bytes: ${baseBytes}, inputs: ${JSON.stringify(inputMap(baseInputs))} } } },
      currentMetafile: { outputs: { 'main.js': { bytes: ${currentBytes}, inputs: ${JSON.stringify(inputMap(currentInputs))} } } },
      skillsCliGzipBytes: 12345,
    });
    process.stdout.write(JSON.stringify(result));
  `;
  return JSON.parse(execFileSync('node', ['--input-type=module', '--eval', code], {
    cwd: rootDir,
    encoding: 'utf8',
  })) as {
    markdown: string;
    warning: boolean;
    delta: number;
    ratio: number;
    largestInputs: Array<{ input: string; bytes: number; delta: number }>;
  };
}

describe('bundle report', () => {
  it('reports totals, the embedded CLI, and largest inputs in descending order', () => {
    const result = report(1_000_000, 1_010_000, {
      'src/a.ts': 120,
      'src/b.ts': 40,
      'src/c.ts': 200,
    });

    expect(result).toMatchObject({ delta: 10_000, ratio: 0.01, warning: false });
    expect(result.largestInputs).toEqual([
      { input: 'src/c.ts', bytes: 200, delta: 200 },
      { input: 'src/a.ts', bytes: 120, delta: 20 },
      { input: 'src/b.ts', bytes: 40, delta: -10 },
    ]);
    expect(result.markdown).toContain('**Embedded Skills CLI (gzip):** 12,345 B');
    expect(result.markdown).toContain('| `src/c.ts` | 200 B | +200 B |');
    expect(result.markdown).not.toContain('[!WARNING]');
  });

  it.each([
    ['100 KiB', 10_000_000, 10_102_401],
    ['2%', 1_000_000, 1_020_001],
  ])('marks growth over the %s soft threshold without failing', (_name, base, current) => {
    const result = report(base, current, { 'src/a.ts': current });

    expect(result.warning).toBe(true);
    expect(result.markdown).toContain('[!WARNING]');
  });

  it('limits the input table to the largest 20 entries', () => {
    const inputs = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [`src/${index}.ts`, index]),
    );

    const result = report(100, 100, inputs);

    expect(result.largestInputs).toHaveLength(20);
    expect(result.largestInputs[0]).toMatchObject({ input: 'src/24.ts', bytes: 24 });
    expect(result.largestInputs.at(-1)).toMatchObject({ input: 'src/5.ts', bytes: 5 });
  });
});
