import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createFileProviderLegacyAuthStore } from '@pivi/obsidian-host/ProviderLegacyAuthStore';

describe('createFileProviderLegacyAuthStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-legacy-auth-store-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no path is available', () => {
    expect(createFileProviderLegacyAuthStore(null)).toBeNull();
  });

  it('reads and writes legacy credential data through the file-backed host adapter', () => {
    const authPath = path.join(tempDir, 'auth.json');
    const store = createFileProviderLegacyAuthStore(authPath);

    expect(store).not.toBeNull();
    expect(store?.read()).toBeNull();

    store?.write({
      'openai-codex': {
        type: 'oauth',
        access: 'access-token',
        refresh: 'refresh-token',
      },
    });

    expect(store?.read()).toEqual({
      'openai-codex': {
        type: 'oauth',
        access: 'access-token',
        refresh: 'refresh-token',
      },
    });
  });

  it('returns null for invalid legacy JSON', () => {
    const authPath = path.join(tempDir, 'auth.json');
    const store = createFileProviderLegacyAuthStore(authPath);

    fs.writeFileSync(authPath, '{not json', 'utf-8');

    expect(store?.read()).toBeNull();
  });
});
