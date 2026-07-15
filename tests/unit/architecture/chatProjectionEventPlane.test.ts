import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const productionRoots = [
  join(root, 'src/ui/chat'),
  join(root, 'packages/pivi-react/src/chat'),
];

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('chat projection event plane', () => {
  it('routes every production projection mutation through dispatch', () => {
    const mutationCalls = productionRoots.flatMap(listTypeScriptFiles).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(
        /(?:projectionStore|store)\.(dispatch|replaceAll|upsertNow|queueUpsert|truncate|flush|prependPreviousPage|prependPage)\s*\(/g,
      )].map(match => ({ file, method: match[1] }));
    });

    expect(mutationCalls.length).toBeGreaterThan(0);
    expect(new Set(mutationCalls.map(call => call.method))).toEqual(new Set(['dispatch']));
  });

  it('keeps the coalescing queue private to the projection store', () => {
    const source = readFileSync(
      join(root, 'packages/pivi-react/src/store/chatProjectionStore.ts'),
      'utf8',
    );

    expect(source).toMatch(/private queueUpsert\(message: ChatMessage\): void/);
    expect(source).not.toContain('type ChatUiEvent');
  });
});
