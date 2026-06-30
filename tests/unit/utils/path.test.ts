import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  isPathWithinDirectory,
  normalizePathForComparison,
  normalizePathForFilesystem,
  translateMsysPath,
} from '../../../src/utils/path';

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

describe('path utils', () => {
  describe('translateMsysPath', () => {
    it('leaves paths unchanged on non-Windows platforms', () => {
      expect(withPlatform('linux', () => translateMsysPath('/c/Users/Alice/vault'))).toBe('/c/Users/Alice/vault');
    });

    it('translates Git Bash drive paths on Windows', () => {
      expect(withPlatform('win32', () => translateMsysPath('/c/Users/Alice/vault'))).toBe('C:\\Users\\Alice\\vault');
      expect(withPlatform('win32', () => translateMsysPath('/z'))).toBe('Z:');
    });

    it('does not translate non-drive MSYS-style paths on Windows', () => {
      expect(withPlatform('win32', () => translateMsysPath('/usr/bin'))).toBe('/usr/bin');
    });
  });

  describe('normalizePathForFilesystem', () => {
    it('returns an empty string for empty input', () => {
      expect(normalizePathForFilesystem('')).toBe('');
    });

    it('normalizes dot segments using the host filesystem rules', () => {
      expect(normalizePathForFilesystem('folder/./child/../note.md')).toBe(path.normalize('folder/note.md'));
    });

    it('expands home-prefixed paths before normalizing', () => {
      expect(normalizePathForFilesystem('~/vault/../note.md')).toBe(path.join(os.homedir(), 'note.md'));
    });

    it('normalizes Windows paths, MSYS drive paths, and long-path prefixes on Windows', () => {
      withPlatform('win32', () => {
        expect(normalizePathForFilesystem('C:/Users/Alice/../Bob/vault')).toBe('C:\\Users\\Bob\\vault');
        expect(normalizePathForFilesystem('/c/Users/Alice/vault')).toBe('C:\\Users\\Alice\\vault');
        expect(normalizePathForFilesystem('\\\\?\\C:\\Users\\Alice\\vault')).toBe('C:\\Users\\Alice\\vault');
        expect(normalizePathForFilesystem('\\\\?\\UNC\\server\\share\\vault')).toBe('\\\\server\\share\\vault');
      });
    });
  });

  describe('normalizePathForComparison', () => {
    it('uses forward slashes and strips trailing slashes', () => {
      expect(normalizePathForComparison('folder/note/')).toBe('folder/note');
    });

    it('preserves case on non-Windows platforms', () => {
      expect(withPlatform('linux', () => normalizePathForComparison('/Vault/Note.md'))).toBe('/Vault/Note.md');
    });

    it('lowercases and slash-normalizes Windows paths for comparison', () => {
      withPlatform('win32', () => {
        expect(normalizePathForComparison('C:\\Users\\Alice\\Vault\\')).toBe('c:/users/alice/vault');
        expect(normalizePathForComparison('/c/Users/Alice/Vault/')).toBe('c:/users/alice/vault');
      });
    });
  });

  describe('isPathWithinDirectory', () => {
    let root: string;
    let directory: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-path-test-'));
      directory = path.join(root, 'vault');
      fs.mkdirSync(path.join(directory, 'notes'), { recursive: true });
      fs.mkdirSync(path.join(root, 'vault-sibling'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'notes', 'note.md'), 'hello');
      fs.writeFileSync(path.join(root, 'vault-sibling', 'note.md'), 'outside');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('accepts the directory itself and descendants', () => {
      expect(isPathWithinDirectory(directory, directory)).toBe(true);
      expect(isPathWithinDirectory(path.join(directory, 'notes', 'note.md'), directory)).toBe(true);
    });

    it('rejects sibling paths that only share a string prefix', () => {
      expect(isPathWithinDirectory(path.join(root, 'vault-sibling', 'note.md'), directory)).toBe(false);
    });

    it('resolves relative candidates against the supplied relative base path', () => {
      expect(isPathWithinDirectory('notes/note.md', directory, directory)).toBe(true);
      expect(isPathWithinDirectory('../vault-sibling/note.md', directory, directory)).toBe(false);
    });

    it('rejects blank candidate or directory paths', () => {
      expect(isPathWithinDirectory('', directory)).toBe(false);
      expect(isPathWithinDirectory('notes/note.md', '')).toBe(false);
    });
  });
});
