import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ExternalFileApi } from '@pivi/obsidian-host';

describe('ExternalFileApi', () => {
  let api: ExternalFileApi;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pivi-external-'));
    api = new ExternalFileApi([tempDir]);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('reads a file by absolute path', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      await fs.promises.writeFile(filePath, 'hello world', 'utf8');

      const result = await api.readFile(filePath);

      expect(result.path).toBe(filePath);
      expect(result.content).toBe('hello world');
    });

    it('expands ~ to the home directory', async () => {
      const filePath = path.join(tempDir, 'tilde.txt');
      await fs.promises.writeFile(filePath, 'tilde content', 'utf8');
      const home = os.homedir();
      const relative = path.relative(home, filePath);
      const tildeInput = `~/${relative.replace(/\\/g, '/')}`;

      const result = await api.readFile(tildeInput);

      expect(result.content).toBe('tilde content');
    });

    it('throws a clear error when file is missing', async () => {
      const filePath = path.join(tempDir, 'missing.txt');

      await expect(api.readFile(filePath)).rejects.toThrow(`External file not found: ${filePath}`);
    });

    it('throws when path is a directory', async () => {
      const dirPath = path.join(tempDir, 'folder');
      await fs.promises.mkdir(dirPath);

      await expect(api.readFile(dirPath)).rejects.toThrow('External path is a directory');
    });

    it('throws when path is not absolute', async () => {
      await expect(api.readFile('relative/path.txt')).rejects.toThrow('External path must be absolute');
    });

    it('throws when path is outside allowed directories', async () => {
      const otherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pivi-external-other-'));
      const filePath = path.join(otherDir, 'file.txt');
      await fs.promises.writeFile(filePath, 'nope', 'utf8');

      try {
        await expect(api.readFile(filePath)).rejects.toThrow('External path is outside allowed directories');
      } finally {
        await fs.promises.rm(otherDir, { recursive: true, force: true });
      }
    });

    it('throws when no directories are allowed', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      await fs.promises.writeFile(filePath, 'content', 'utf8');

      await expect(new ExternalFileApi().readFile(filePath)).rejects.toThrow('No external directories are allowed');
    });
  });

  describe('listPath', () => {
    it('lists files and folders in a directory', () => {
      const filePath = path.join(tempDir, 'file.txt');
      const folderPath = path.join(tempDir, 'folder');
      fs.writeFileSync(filePath, 'content', 'utf8');
      fs.mkdirSync(folderPath);

      const result = api.listPath(tempDir);

      const fileEntry = result.find((e) => e.name === 'file.txt');
      const folderEntry = result.find((e) => e.name === 'folder');

      expect(fileEntry).toMatchObject({ path: filePath, kind: 'file', name: 'file.txt', extension: 'txt' });
      expect(fileEntry?.size).toBeGreaterThan(0);
      expect(folderEntry).toMatchObject({ path: folderPath, kind: 'folder', name: 'folder' });
    });

    it('throws when directory is missing', () => {
      const missingPath = path.join(tempDir, 'missing');

      expect(() => api.listPath(missingPath)).toThrow(`External directory not found: ${missingPath}`);
    });

    it('throws when path is a file', () => {
      const filePath = path.join(tempDir, 'file.txt');
      fs.writeFileSync(filePath, 'content', 'utf8');

      expect(() => api.listPath(filePath)).toThrow('External path is not a directory');
    });
  });

  describe('stat', () => {
    it('returns file stat info', () => {
      const filePath = path.join(tempDir, 'file.txt');
      fs.writeFileSync(filePath, 'content', 'utf8');

      const result = api.stat(filePath);

      expect(result).toMatchObject({ path: filePath, isFile: true, isDirectory: false });
      expect(result.size).toBeGreaterThan(0);
    });

    it('returns directory stat info', async () => {
      const dirPath = path.join(tempDir, 'folder');
      await fs.promises.mkdir(dirPath);

      const result = api.stat(dirPath);

      expect(result).toMatchObject({ path: dirPath, isFile: false, isDirectory: true });
    });
  });
});
