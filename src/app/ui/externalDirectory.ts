/**
 * Desktop directory pick/validate helpers for app-owned settings ports.
 * Chat UI keeps parallel helpers under `src/ui/shared/utils/` so product UI
 * does not import `@/app/ui/**`.
 */

import * as fs from 'fs';

interface ElectronOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface ElectronRemoteApi {
  dialog: {
    showOpenDialog(options: {
      properties: string[];
      title?: string;
    }): Promise<ElectronOpenDialogResult>;
  };
}

type NodeRequireFn = (moduleName: string) => unknown;

function getGlobalRequire(value: unknown): NodeRequireFn {
  if (!value || typeof value !== 'object' || !('require' in value) || typeof value.require !== 'function') {
    throw new Error('Electron require API is unavailable');
  }
  const hostRequire = value.require;
  return (moduleName: string) => {
    const moduleValue: unknown = Reflect.apply(hostRequire, value, [moduleName]);
    return moduleValue;
  };
}

function isElectronRemoteApi(value: unknown): value is ElectronRemoteApi {
  if (!value || typeof value !== 'object' || !('dialog' in value)) {
    return false;
  }
  const { dialog } = value;
  return (
    !!dialog
    && typeof dialog === 'object'
    && 'showOpenDialog' in dialog
    && typeof dialog.showOpenDialog === 'function'
  );
}

function getElectronRemote(hostWindow: Window): ElectronRemoteApi {
  const electron = getGlobalRequire(hostWindow)('electron');
  if (
    !electron
    || typeof electron !== 'object'
    || !('remote' in electron)
    || !isElectronRemoteApi(electron.remote)
  ) {
    throw new Error('Electron remote API is unavailable');
  }
  return electron.remote;
}

export interface DirectoryValidationResult {
  valid: boolean;
  error?: string;
}

export function validateDirectoryPath(p: string): DirectoryValidationResult {
  try {
    const stats = fs.statSync(p);
    if (!stats.isDirectory()) {
      return { valid: false, error: 'Path exists but is not a directory' };
    }
    return { valid: true };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { valid: false, error: 'Path does not exist' };
    }
    if (error.code === 'EACCES') {
      return { valid: false, error: 'Permission denied' };
    }
    return { valid: false, error: `Cannot access path: ${error.message}` };
  }
}

export interface PickDirectoryOptions {
  /** Dialog window title. */
  title?: string;
  /** Window that owns the Electron require bridge. Defaults to activeWindow. */
  hostWindow?: Window | null;
}

/**
 * Opens the native OS folder picker.
 * @returns Absolute selected path, or `null` if the user canceled.
 * @throws If Electron desktop APIs are unavailable.
 */
export async function pickDirectoryPath(options: PickDirectoryOptions = {}): Promise<string | null> {
  const hostWindow = options.hostWindow ?? activeWindow;
  const remote = getElectronRemote(hostWindow);
  const result = await remote.dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: options.title,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}
