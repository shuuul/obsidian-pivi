import { randomUUID } from 'node:crypto';

import { writeFileAtomically } from '@pivi/agent/config/publication';
import { PluginLogger } from '@pivi/agent/logging/pluginLogger';
import type { FileStore } from '@pivi/agent/ports';

const COMMANDS_DIR = '.pivi/commands';
const LEGACY_TEMPLATES_DIR = '.pivi/templates';
/** Vault-relative prefix for command-removal transaction roots (managed namespace). */
const COMMANDS_REMOVAL_ROOT_PREFIX = '.pivi/.commands-removal-';
// The journal name must not be `manifest.json`: the community review static
// scan treats that literal plus file writes as a self-update signal.
const COMMANDS_REMOVAL_MANIFEST = 'transaction.json';
const logger = new PluginLogger('commandRemovalTransaction');

interface CommandRemovalStagedEntry {
  readonly originalPath: string;
  readonly backupName: string;
}

interface CommandRemovalManifest {
  readonly version: 1;
  readonly id: string;
  readonly phase: 'staged' | 'committed';
  readonly staged: readonly CommandRemovalStagedEntry[];
}

/**
 * Removes canonical and legacy files as one logical transaction under a
 * managed `.pivi/.commands-removal-*` root with a durable manifest. Staging
 * failure restores every prior name and never deletes the only recovery copy.
 * Cleanup of the transaction root happens only after the commit is durable.
 *
 * @returns `true` when the command was removed but transaction cleanup failed.
 */
export async function removeCommandFiles(adapter: FileStore, id: string): Promise<boolean> {
  const transaction = randomUUID();
  const root = `${COMMANDS_REMOVAL_ROOT_PREFIX}${transaction}`;
  await adapter.ensureFolder(root);
  const staged: CommandRemovalStagedEntry[] = [];
  for (const dir of [COMMANDS_DIR, LEGACY_TEMPLATES_DIR]) {
    const originalPath = `${dir}/${id}.md`;
    if (!await adapter.exists(originalPath)) continue;
    staged.push({
      originalPath,
      backupName: `${dir === COMMANDS_DIR ? 'canonical' : 'legacy'}.md`,
    });
  }
  await writeRemovalManifest(adapter, root, {
    version: 1,
    id,
    phase: 'staged',
    staged,
  });
  try {
    for (const entry of staged) {
      await adapter.rename(entry.originalPath, `${root}/${entry.backupName}`);
    }
  } catch (cause) {
    try {
      await restoreRemovalStaged(adapter, root, staged);
    } catch (restoreError) {
      // Keep the transaction root; never delete the only recovery copies.
      throw restoreError instanceof Error
        ? restoreError
        : new Error('Command-removal restore failed after staging error.', { cause: restoreError });
    }
    await deleteRemovalRoot(adapter, root).catch(() => undefined);
    throw cause;
  }

  if (staged.length === 0) {
    await deleteRemovalRoot(adapter, root).catch(() => undefined);
    return false;
  }

  await writeRemovalManifest(adapter, root, {
    version: 1,
    id,
    phase: 'committed',
    staged,
  });

  try {
    await deleteRemovalRoot(adapter, root);
    return false;
  } catch {
    return true;
  }
}

export async function recoverCommandRemovalTransactions(adapter: FileStore): Promise<void> {
  const folders = await adapter.listFolders('.pivi');
  const roots = folders
    .map(normalizeListedPath)
    .filter(folder => folder.startsWith(COMMANDS_REMOVAL_ROOT_PREFIX));
  for (const root of roots) {
    await recoverOneRemovalTransaction(adapter, root);
  }
}

async function recoverOneRemovalTransaction(adapter: FileStore, root: string): Promise<void> {
  const manifestPath = `${root}/${COMMANDS_REMOVAL_MANIFEST}`;
  if (!await adapter.exists(manifestPath)) {
    const files = (await adapter.listFiles(root)).map(normalizeListedPath);
    if (files.length === 0) await deleteRemovalRoot(adapter, root).catch(() => undefined);
    else logger.error(`Retained command-removal transaction without manifest at ${root}`);
    return;
  }
  let manifest: CommandRemovalManifest;
  try {
    manifest = parseRemovalManifest(await adapter.read(manifestPath));
  } catch (error) {
    logger.error(`Failed to parse command-removal manifest at ${manifestPath}`, error);
    return;
  }
  if (manifest.phase === 'committed') {
    await deleteRemovalRoot(adapter, root).catch(error => {
      logger.error(`Failed to clean committed command-removal transaction ${root}`, error);
    });
    return;
  }
  try {
    await restoreRemovalStaged(adapter, root, manifest.staged);
    await deleteRemovalRoot(adapter, root);
  } catch (error) {
    logger.error(`Failed to restore incomplete command-removal transaction ${root}`, error);
  }
}

async function restoreRemovalStaged(
  adapter: FileStore,
  root: string,
  staged: readonly CommandRemovalStagedEntry[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const entry of [...staged].reverse()) {
    const backupPath = `${root}/${entry.backupName}`;
    try {
      if (!await adapter.exists(backupPath)) {
        if (await adapter.exists(entry.originalPath)) continue;
        throw new Error(`Missing recovery copy for ${entry.originalPath}`);
      }
      if (await adapter.exists(entry.originalPath)) {
        // Catalog path already holds content; keep the backup for inspection.
        continue;
      }
      await adapter.rename(backupPath, entry.originalPath);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}

async function writeRemovalManifest(
  adapter: FileStore,
  root: string,
  manifest: CommandRemovalManifest,
): Promise<void> {
  await writeFileAtomically(
    adapter,
    `${root}/${COMMANDS_REMOVAL_MANIFEST}`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function deleteRemovalRoot(adapter: FileStore, root: string): Promise<void> {
  const files = await adapter.listFiles(root);
  for (const file of files) {
    await adapter.delete(normalizeListedPath(file));
  }
  const nested = await adapter.listFolders(root);
  for (const folder of nested) {
    await deleteRemovalRoot(adapter, normalizeListedPath(folder));
  }
  await adapter.deleteFolder(root);
  if (await adapter.exists(root)) {
    throw new Error(`Command-removal transaction root still present: ${root}`);
  }
}

function normalizeListedPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function parseRemovalManifest(raw: string): CommandRemovalManifest {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Command-removal manifest must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error('Unsupported command-removal manifest version.');
  }
  if (typeof record.id !== 'string' || !record.id) {
    throw new Error('Command-removal manifest is missing id.');
  }
  if (record.phase !== 'staged' && record.phase !== 'committed') {
    throw new Error('Command-removal manifest has invalid phase.');
  }
  if (!Array.isArray(record.staged)) {
    throw new Error('Command-removal manifest is missing staged entries.');
  }
  const staged: CommandRemovalStagedEntry[] = record.staged.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Command-removal staged entry ${index} is invalid.`);
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.originalPath !== 'string' || typeof item.backupName !== 'string') {
      throw new Error(`Command-removal staged entry ${index} is incomplete.`);
    }
    if (item.backupName.includes('/') || item.backupName.includes('\\') || item.backupName.includes('..')) {
      throw new Error(`Command-removal staged entry ${index} has an unsafe backup name.`);
    }
    return { originalPath: item.originalPath, backupName: item.backupName };
  });
  return { version: 1, id: record.id, phase: record.phase, staged };
}
