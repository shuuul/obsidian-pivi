import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  normalizePathForVault,
  requireVaultRelativeMutationPath,
} from '@pivi/obsidian-host/path';

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, 'platform', descriptor);
    }
  }
}

describe('requireVaultRelativeMutationPath', () => {
  let root: string;
  let vaultPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-mutation-'));
    vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, 'notes', 'a.md'), 'hello');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts nested vault-relative paths', () => {
    expect(requireVaultRelativeMutationPath('notes/a.md', vaultPath)).toBe('notes/a.md');
    expect(requireVaultRelativeMutationPath('notes/./b.md', vaultPath)).toBe('notes/b.md');
  });

  it('rejects empty, root, traversal, and NUL', () => {
    expect(() => requireVaultRelativeMutationPath('', vaultPath)).toThrow(/non-empty/i);
    expect(() => requireVaultRelativeMutationPath('.', vaultPath)).toThrow(/vault root/i);
    expect(() => requireVaultRelativeMutationPath('../escape.md', vaultPath)).toThrow(/traversal/i);
    expect(() => requireVaultRelativeMutationPath('notes/../outside.md', vaultPath)).toThrow(/traversal/i);
    expect(() => requireVaultRelativeMutationPath('notes/a\0.md', vaultPath)).toThrow(/NUL/i);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => requireVaultRelativeMutationPath('/tmp/evil.md', vaultPath)).toThrow(/vault-relative/i);
  });

  it('rejects Windows drive, UNC, and device paths', () => {
    withPlatform('win32', () => {
      expect(() => requireVaultRelativeMutationPath('C:\\Users\\x\\note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('C:note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('\\\\server\\share\\note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('\\\\.\\pipe\\x', vaultPath)).toThrow(/vault-relative/i);
    });
  });

  it('rejects duplicate separators that look like UNC', () => {
    expect(() => requireVaultRelativeMutationPath('notes//a.md', vaultPath)).toThrow(/vault-relative|separator/i);
  });

  it('contains creation beneath a symlinked parent that escapes the vault', () => {
    if (process.platform === 'win32') {
      return;
    }
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(vaultPath, 'linked');
    fs.symlinkSync(outside, link);
    expect(() => requireVaultRelativeMutationPath('linked/new.md', vaultPath)).toThrow(/escapes/i);
  });

  it('contains an existing symlink target outside the vault', () => {
    if (process.platform === 'win32') {
      return;
    }
    const outsideFile = path.join(root, 'outside.md');
    fs.writeFileSync(outsideFile, 'x');
    const link = path.join(vaultPath, 'escape.md');
    fs.symlinkSync(outsideFile, link);
    expect(() => requireVaultRelativeMutationPath('escape.md', vaultPath)).toThrow(/escapes/i);
  });

  it('preserves display normalization separately from mutation validation', () => {
    const absoluteOutside = path.join(root, 'sibling', 'note.md');
    fs.mkdirSync(path.dirname(absoluteOutside), { recursive: true });
    fs.writeFileSync(absoluteOutside, 'x');
    expect(normalizePathForVault(absoluteOutside, vaultPath)).toBe(absoluteOutside.replace(/\\/g, '/'));
    expect(() => requireVaultRelativeMutationPath(absoluteOutside, vaultPath)).toThrow(/vault-relative/i);
  });

  it('preserves case on case-sensitive platforms and still contains escapes', () => {
    withPlatform('linux', () => {
      expect(requireVaultRelativeMutationPath('Notes/A.md', vaultPath)).toBe('Notes/A.md');
    });
  });
});
