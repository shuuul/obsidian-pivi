import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const chatRoot = join(root, 'src/ui/chat');

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('chat projection event plane', () => {
  it('routes every production projection mutation through dispatch', () => {
    const mutationCalls = listTypeScriptFiles(chatRoot).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(
        /projectionStore\.(dispatch|replaceAll|upsertNow|queueUpsert|truncate|flush)\s*\(/g,
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
