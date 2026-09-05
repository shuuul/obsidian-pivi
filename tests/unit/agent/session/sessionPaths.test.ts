import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  encodeSessionCwd,
  getPiviSessionDir,
  getPiviSessionRoot,
  getPiviSessionTrashRoot,
  toAbsoluteSessionPath,
  toLiveSessionFile,
  toTrashedSessionFile,
  toVaultRelativePath,
} from '@pivi/agent/session/sessionPaths';

describe('sessionPaths', () => {
  it('encodes absolute vault paths for pi-compatible session directories', () => {
    const vaultPath = process.platform === 'win32'
      ? 'C:\\Users\\example\\Vault:Main'
      : '/Users/example/Vault:Main';
    const encoded = encodeSessionCwd(vaultPath);

    expect(encoded).toBe(process.platform === 'win32'
      ? '--C--Users-example-Vault-Main--'
      : '--Users-example-Vault-Main--');
  });

  it('computes the vault-local session directory without creating it', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-session-paths-'));
    const vaultPath = path.join(tempRoot, 'Vault');

    const sessionDir = getPiviSessionDir(vaultPath);

    expect(getPiviSessionRoot(vaultPath)).toBe(
      path.join(vaultPath, '.pivi', 'sessions'),
    );
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

  it('mirrors live session files into the trash tree and back', () => {
    const live = '.pivi/sessions/--Users-me-Vault--/chat.jsonl';
    const trashed = toTrashedSessionFile(live);
    expect(trashed).toBe('.pivi/trash/sessions/--Users-me-Vault--/chat.jsonl');
    expect(toLiveSessionFile(trashed)).toBe(live);
    expect(getPiviSessionTrashRoot('/tmp/vault')).toBe(
      path.join('/tmp/vault', '.pivi', 'trash', 'sessions'),
    );
  });
});
