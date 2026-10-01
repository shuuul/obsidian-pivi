import {
  legacyVaultAuthEntryPath,
  readLegacyVaultAuthEntry,
} from '@pivi/agent/mcp/oauth/legacyVaultAuthEntry';
import type { FileStore } from '@pivi/agent/ports';

function createAdapter(files: Record<string, string>): FileStore {
  return {
    exists: async (path: string) => path in files,
    read: async (path: string) => files[path]!,
  } as unknown as FileStore;
}

describe('readLegacyVaultAuthEntry', () => {
  it('reads the plaintext entry earlier versions wrote', async () => {
    const adapter = createAdapter({
      [legacyVaultAuthEntryPath('github')]: JSON.stringify({ tokens: { accessToken: 'token-a' } }),
    });

    await expect(readLegacyVaultAuthEntry(adapter, 'github')).resolves.toEqual({
      tokens: { accessToken: 'token-a' },
    });
  });

  it('returns undefined when the tokens file is missing', async () => {
    await expect(readLegacyVaultAuthEntry(createAdapter({}), 'missing')).resolves.toBeUndefined();
  });

  it.each([
    ['invalid JSON', 'not-json{{{'],
    ['null', 'null'],
    ['a string', '"hello"'],
    ['a number', '42'],
    ['a boolean', 'true'],
  ])('returns undefined when the file holds %s', async (_label, raw) => {
    const adapter = createAdapter({ [legacyVaultAuthEntryPath('corrupt')]: raw });

    await expect(readLegacyVaultAuthEntry(adapter, 'corrupt')).resolves.toBeUndefined();
  });
});
