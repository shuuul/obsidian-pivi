import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('window.fetch identity', () => {
  it('does not patch window.fetch in source and leaves the identity unchanged at runtime', () => {
    const mainSource = readFileSync(path.resolve(__dirname, '../../../src/main.ts'), 'utf8');
    expect(mainSource).not.toContain('patchRendererFetchForElectron');
    expect(mainSource).not.toMatch(/window\.fetch\s*=/);

    const nodeFetchSource = readFileSync(
      path.resolve(__dirname, '../../../packages/obsidian-host/src/nodeFetch.ts'),
      'utf8',
    );
    expect(nodeFetchSource).not.toContain('patchRendererFetchForElectron');
    expect(nodeFetchSource).not.toMatch(/window\.fetch\s*=/);

    const original = window.fetch;
    expect(window.fetch).toBe(original);
  });
});
