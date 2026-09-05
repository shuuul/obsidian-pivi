import { type App, type TFile } from 'obsidian';

const RECOVERABLE_EXTENSIONS = new Set(['md', 'canvas']);

interface FileRecoveryInternalPlugin {
  forceAdd(path: string, data: string): Promise<void>;
}

interface AppWithInternalPlugins {
  internalPlugins?: {
    getEnabledPluginById?(id: string): unknown;
  };
}

function getFileRecoveryPlugin(app: App): FileRecoveryInternalPlugin | null {
  const internalPlugins = (app as AppWithInternalPlugins).internalPlugins;
  if (!internalPlugins?.getEnabledPluginById) {
    return null;
  }
  const plugin = internalPlugins.getEnabledPluginById('file-recovery');
  if (!plugin || typeof (plugin as FileRecoveryInternalPlugin).forceAdd !== 'function') {
    return null;
  }
  return plugin as FileRecoveryInternalPlugin;
}

/**
 * Capture a required pre-mutation snapshot through Obsidian File Recovery's
 * private `forceAdd` API. Unsupported file types have no File Recovery history.
 */
export async function captureFileRecoverySnapshot(app: App, file: TFile): Promise<void> {
  if (!RECOVERABLE_EXTENSIONS.has(file.extension)) {
    return;
  }

  const fileRecovery = getFileRecoveryPlugin(app);
  if (!fileRecovery) {
    throw new Error(
      `Cannot modify ${file.path}: Obsidian File Recovery is disabled, unavailable, or missing the required snapshot API. Enable File Recovery and retry.`,
    );
  }

  try {
    const content = await app.vault.cachedRead(file);
    await fileRecovery.forceAdd(file.path, content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot modify ${file.path}: required File Recovery snapshot failed (${reason}).`,
      { cause: error },
    );
  }
}
