import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  encodeSessionCwd,
  getPiviSessionDir,
  toAbsoluteSessionPath,
  toVaultRelativePath,
} from '@pivi/pivi-agent-core/session/sessionPaths';

describe('sessionPaths', () => {
  it('encodes absolute vault paths for pi-compatible session directories', () => {
    const encoded = encodeSessionCwd('/Users/example/Vault:Main');

    expect(encoded).toBe('--Users-example-Vault-Main--');
  });

  it('computes the vault-local session directory without creating it', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-paths-'));
    const vaultPath = path.join(tempRoot, 'Vault');

    const sessionDir = getPiviSessionDir(vaultPath);

    expect(sessionDir).toBe(
      path.join(vaultPath, '.pivi', 'sessions', encodeSessionCwd(vaultPath)),
    );
    expect(fs.existsSync(sessionDir)).toBe(false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('converts an absolute session file under the vault to a forward-slash relative path', () => {
    const vaultPath = path.join('/tmp', 'vault');
    const absoluteSession = path.join(vaultPath, '.pivi', 'sessions', 'session.jsonl');

    expect(toVaultRelativePath(vaultPath, absoluteSession)).toBe(
      '.pivi/sessions/session.jsonl',
    );
  });

  it('resolves forward-slash vault-relative session files to absolute paths', () => {
    const vaultPath = path.join('/tmp', 'vault');

    expect(toAbsoluteSessionPath(vaultPath, '.pivi/sessions/session.jsonl')).toBe(
      path.join(vaultPath, '.pivi', 'sessions', 'session.jsonl'),
    );
  });
});
