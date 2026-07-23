import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import { type App, type TFile } from 'obsidian';

const logger = new PluginLogger('FileRecoverySnapshot');

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

export function isFileRecoveryEnabled(app: App): boolean {
  return getFileRecoveryPlugin(app) !== null;
}

/**
 * Best-effort pre-write snapshot into Obsidian File Recovery via the internal
 * `forceAdd` API. Mutations must continue when File Recovery is unavailable.
 */
export async function captureFileRecoverySnapshot(app: App, file: TFile): Promise<void> {
  if (!RECOVERABLE_EXTENSIONS.has(file.extension)) {
    return;
  }

  const fileRecovery = getFileRecoveryPlugin(app);
  if (!fileRecovery) {
    // File Recovery disabled/unavailable is expected; do not warn per write.
    return;
  }

  try {
    const content = await app.vault.cachedRead(file);
    await fileRecovery.forceAdd(file.path, content);
  } catch (error) {
    logger.warn('File Recovery pre-write snapshot skipped', {
      path: file.path,
      reason: 'capture_failed',
      error,
    });
  }
}
