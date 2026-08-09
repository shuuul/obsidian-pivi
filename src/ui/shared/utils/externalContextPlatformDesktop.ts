import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  expandHomePath,
  normalizePathForComparison,
  normalizePathForFilesystem,
} from '@/app/hostPlatform';

import type { ExternalContextPlatform } from './externalContextPlatform';

export const desktopExternalContextPlatform: ExternalContextPlatform = {
  expandPath: expandHomePath,
  normalizePath: normalizePathForFilesystem,
  normalizeForComparison: normalizePathForComparison,
  isAbsolute: path.isAbsolute,
  homeDirectory: os.homedir,
  validateDirectory(value) {
    try {
      const stats = fs.statSync(value);
      return stats.isDirectory()
        ? { valid: true }
        : { valid: false, error: 'Path exists but is not a directory' };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code === 'ENOENT') return { valid: false, error: 'Path does not exist' };
      if (failure.code === 'EACCES') return { valid: false, error: 'Permission denied' };
      return { valid: false, error: `Cannot access path: ${failure.message}` };
    }
  },
};
