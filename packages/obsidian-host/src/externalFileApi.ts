import * as fs from 'fs';
import * as path from 'path';

import { isPathWithinDirectory, normalizePathForFilesystem } from './path';

export interface ExternalFileEntry {
  path: string;
  kind: 'file' | 'folder';
  name: string;
  extension?: string;
  size?: number;
}

export interface ExternalFileReadResult {
  path: string;
  content: string;
}

export interface ExternalFileStat {
  path: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface ExternalDirectoryAvailability {
  path: string;
  available: boolean;
  reason?: 'not-found' | 'not-directory' | 'permission-denied' | 'unreadable';
}

/** Inspect a selected external root immediately before a turn uses it. */
export function inspectExternalDirectory(directory: string): ExternalDirectoryAvailability {
  const normalized = normalizePathForFilesystem(directory);
  try {
    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) {
      return { path: normalized, available: false, reason: 'not-directory' };
    }
    fs.accessSync(normalized, fs.constants.R_OK);
    return { path: normalized, available: true };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ENOENT') {
      return { path: normalized, available: false, reason: 'not-found' };
    }
    if (errno.code === 'EACCES' || errno.code === 'EPERM') {
      return { path: normalized, available: false, reason: 'permission-denied' };
    }
    return { path: normalized, available: false, reason: 'unreadable' };
  }
}

export class ExternalFileApi {
  private readonly allowedDirectories: string[];

  constructor(allowedDirectories: readonly string[] = []) {
    this.allowedDirectories = ExternalFileApi.normalizeAllowedDirectories(allowedDirectories);
  }

  static normalizeAllowedDirectories(allowedDirectories: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalizedDirectories: string[] = [];
    for (const directory of allowedDirectories) {
      const normalized = normalizePathForFilesystem(directory);
      if (!normalized || !path.isAbsolute(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      normalizedDirectories.push(normalized);
    }
    return normalizedDirectories;
  }

  withAdditionalAllowedDirectories(extraDirectories: readonly string[]): ExternalFileApi {
    return new ExternalFileApi([...this.allowedDirectories, ...extraDirectories]);
  }

  private normalizeAbsolutePath(absolutePath: string): string {
    const normalized = normalizePathForFilesystem(absolutePath);
    if (!normalized) {
      throw new Error('Invalid external path: empty path');
    }
    if (!path.isAbsolute(normalized)) {
      throw new Error(`External path must be absolute: ${normalized}`);
    }
    return normalized;
  }

  private assertAllowed(normalizedPath: string): void {
    if (this.allowedDirectories.length === 0) {
      throw new Error('No external directories are allowed. Add allowed directories in Pivi settings before using external read tools.');
    }
    if (this.allowedDirectories.some((directory) => isPathWithinDirectory(normalizedPath, directory, directory))) {
      return;
    }
    throw new Error(`External path is outside allowed directories: ${normalizedPath}`);
  }

  /** Returns whether the normalized absolute path is within configured allowed roots. */
  isPathAllowed(absolutePath: string): boolean {
    try {
      const normalized = this.normalizeAbsolutePath(absolutePath);
      this.assertAllowed(normalized);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads an external file by absolute path.
   * Throws a clear error if the path is missing, inaccessible, or a directory.
   */
  async readFile(absolutePath: string): Promise<ExternalFileReadResult> {
    const normalized = this.normalizeAbsolutePath(absolutePath);
    this.assertAllowed(normalized);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(normalized);
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        throw new Error(`External file not found: ${normalized}`, { cause: err });
      }
      if (errno.code === 'EACCES') {
        throw new Error(`Permission denied for external path: ${normalized}`, { cause: err });
      }
      throw new Error(`Cannot access external file ${normalized}: ${errno.message}`, { cause: err });
    }

    if (stat.isDirectory()) {
      throw new Error(`External path is a directory; use obsidian_list_external for folders: ${normalized}`);
    }
    if (!stat.isFile()) {
      throw new Error(`External path is not a readable file: ${normalized}`);
    }

    const content = await fs.promises.readFile(normalized, 'utf8');
    return { path: normalized, content };
  }

  /**
   * Lists direct children of an external directory.
   * Throws a clear error if the path is missing, inaccessible, or not a directory.
   */
  listPath(absolutePath: string): ExternalFileEntry[] {
    const normalized = this.normalizeAbsolutePath(absolutePath);
    this.assertAllowed(normalized);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(normalized);
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        throw new Error(`External directory not found: ${normalized}`, { cause: err });
      }
      if (errno.code === 'EACCES') {
        throw new Error(`Permission denied for external path: ${normalized}`, { cause: err });
      }
      throw new Error(`Cannot access external directory ${normalized}: ${errno.message}`, { cause: err });
    }

    if (!stat.isDirectory()) {
      throw new Error(`External path is not a directory: ${normalized}`);
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(normalized, { withFileTypes: true });
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      throw new Error(`Cannot list external directory ${normalized}: ${errno.message}`, { cause: err });
    }

    return entries.map((entry) => {
      const fullPath = path.join(normalized, entry.name);
      if (entry.isDirectory()) {
        return { path: fullPath, kind: 'folder', name: entry.name };
      }
      if (entry.isFile()) {
        return {
          path: fullPath,
          kind: 'file',
          name: entry.name,
          extension: path.extname(entry.name).slice(1) || undefined,
          size: fs.statSync(fullPath).size,
        };
      }
      return { path: fullPath, kind: 'file', name: entry.name };
    });
  }

  /**
   * Returns stat info for an external path.
   */
  stat(absolutePath: string): ExternalFileStat {
    const normalized = this.normalizeAbsolutePath(absolutePath);
    this.assertAllowed(normalized);

    try {
      const stat = fs.statSync(normalized);
      return {
        path: normalized,
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
      };
    } catch (err) {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        throw new Error(`External path not found: ${normalized}`, { cause: err });
      }
      if (errno.code === 'EACCES') {
        throw new Error(`Permission denied for external path: ${normalized}`, { cause: err });
      }
      throw new Error(`Cannot stat external path ${normalized}: ${errno.message}`, { cause: err });
    }
  }
}
