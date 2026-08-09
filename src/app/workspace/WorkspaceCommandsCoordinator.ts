import { randomUUID } from 'node:crypto';

import type { SlashCommand } from '@pivi/agent/foundation';
import { runSerializedSave, writeFileAtomically } from '@pivi/agent/foundation/configPublication';
import type { FileStore } from '@pivi/agent/ports';
import type { SlashCatalogEntry } from '@pivi/agent/skills/commands/slashCommandEntry';
import { isReservedCommandId } from '@pivi/agent/skills/commands/slashCommandIds';
import { serializeSlashCommandMarkdown } from '@pivi/agent/skills/slashCommand';
import type { AgentCommandDetail, PiviCommandsInput, PiviManagementMutationResult } from '@pivi/agent/tools/piviManagement';
import { PiviManagementError } from '@pivi/agent/tools/piviManagement';

import { recoverCommandRemovalTransactions, removeCommandFiles } from './commandRemovalTransaction';
import type { PiviWorkspaceHost } from './serviceContracts';

const COMMANDS_DIR = '.pivi/commands';
const LEGACY_TEMPLATES_DIR = '.pivi/templates';
const COMMANDS_MUTATION_KEY = '.pivi/commands/*';

export class PiviCommandsManagementError extends Error {
  constructor(public readonly code: 'not_found' | 'not_eligible' | 'state_changed' | 'invalid_input', message: string) {
    super(message);
    this.name = 'PiviCommandsManagementError';
  }
}

export interface WorkspaceCommandSnapshot {
  readonly entries: readonly SlashCatalogEntry[];
  readonly catalogRevision: number;
}

export interface WorkspaceCommandScan {
  readonly entries: readonly SlashCatalogEntry[];
  readonly fingerprint: string;
}

export type WorkspaceCommandScanner = () => Promise<WorkspaceCommandScan>;

export type WorkspaceCommandsMutation = Extract<PiviCommandsInput, { action: 'upsert' | 'remove' | 'move' }>;
export interface WorkspaceCommandsPlan {
  readonly revision: number;
  readonly mutation: WorkspaceCommandsMutation;
}

/** Workspace-command ids are path-safe slugs, with dots retained for round-trip fidelity. */
export function isValidWorkspaceCommandId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id);
}

/** Owns the command snapshot, revision, mutation policy, lock, and persistence. */
export class WorkspaceCommandsCoordinator {
  private entries: SlashCatalogEntry[] = [];
  private fingerprint: string | undefined;
  private revision = 0;
  private runtimeIds = new Set<string>();

  constructor(
    private readonly host: PiviWorkspaceHost,
    private readonly store: FileStore,
    private readonly createKey: () => string = () => randomUUID(),
    private readonly scanCatalog: WorkspaceCommandScanner,
    private readonly onEntriesChanged?: (entries: readonly SlashCatalogEntry[]) => void,
  ) {}

  setRuntimeIds(ids: readonly string[]): void { this.runtimeIds = new Set(ids); }

  private acceptCatalogScan(entries: readonly SlashCatalogEntry[], fingerprint: string): boolean {
    const changed = fingerprint !== this.fingerprint;
    if (changed && this.revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('Workspace command catalog revision space is exhausted.');
    }
    this.entries = entries.map(entry => ({ ...entry }));
    if (changed) {
      this.fingerprint = fingerprint;
      this.revision += 1;
      this.onEntriesChanged?.(this.currentEntries());
    }
    return changed;
  }

  currentEntries(): SlashCatalogEntry[] { return this.entries.map(entry => ({ ...entry })); }
  currentRevision(): number { return this.revision; }

  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return runSerializedSave(COMMANDS_MUTATION_KEY, operation);
  }

  async snapshot(): Promise<WorkspaceCommandSnapshot> {
    await this.refresh();
    return { entries: this.currentEntries(), catalogRevision: this.revision };
  }

  async plan(input: WorkspaceCommandsMutation, signal?: AbortSignal): Promise<WorkspaceCommandsPlan> {
    await this.refresh();
    throwIfAborted(signal);
    this.requireRevision(input.catalogRevision);
    const id = input.id.trim();
    if (!id || id !== input.id) throw new PiviCommandsManagementError('invalid_input', 'Command id must be non-empty and trimmed.');
    if (!isValidWorkspaceCommandId(id)) {
      throw new PiviCommandsManagementError('invalid_input', 'Command id must be a path-safe slug.');
    }
    this.assertAvailable(id);
    if (input.action === 'upsert') {
      if (input.name !== undefined && input.name !== id) {
        throw new PiviCommandsManagementError('invalid_input', 'Command rename is not supported; name must equal id.');
      }
      if (!input.content.trim()) {
        throw new PiviCommandsManagementError('invalid_input', 'Command content must be non-empty.');
      }
      return { revision: this.revision, mutation: { ...input, id, name: input.name === undefined ? undefined : id,
        content: input.content, description: input.description?.trim() || undefined,
        argumentHint: input.argumentHint?.trim() || undefined, icon: input.icon?.trim() || undefined } };
    }
    const existing = this.entries.find(entry => entry.id === id);
    if (!existing) throw new PiviCommandsManagementError('not_found', `Command /${id} was not found.`);
    if (input.action === 'remove') return { revision: this.revision, mutation: { ...input, id } };
    const beforeId = input.beforeId?.trim();
    const afterId = input.afterId?.trim();
    const anchorId = beforeId ?? afterId;
    if (!anchorId || anchorId === id || !this.entries.some(entry => entry.id === anchorId)) {
      throw new PiviCommandsManagementError('not_eligible', 'Move requires two distinct editable workspace commands.');
    }
    return { revision: this.revision, mutation: beforeId
      ? { action: 'move', id, beforeId, catalogRevision: this.revision }
      : { action: 'move', id, afterId: afterId!, catalogRevision: this.revision } };
  }

  async commit(plan: WorkspaceCommandsPlan, expectedRevision: number, signal?: AbortSignal): Promise<PiviManagementMutationResult<AgentCommandDetail>> {
    return this.withMutationLock(async () => {
      throwIfAborted(signal);
      await this.refreshWithoutLock();
      if (plan.revision !== expectedRevision) throw new PiviCommandsManagementError('state_changed', 'Command plan revision changed.');
      this.requireRevision(expectedRevision);
      const mutation = plan.mutation;
      this.assertAvailable(mutation.id);
      await this.refreshWithoutLock();
      this.requireRevision(expectedRevision);
      throwIfAborted(signal);
      if (mutation.action === 'upsert') return this.commitUpsert(mutation);
      if (mutation.action === 'remove') return this.commitRemove(mutation.id);
      return this.commitMove(mutation);
    });
  }

  async saveEntry(entry: SlashCatalogEntry, revision: number): Promise<void> {
    const plan = await this.plan({ action: 'upsert', id: entry.id, name: entry.id, content: entry.content,
      description: entry.description, argumentHint: entry.argumentHint, icon: entry.icon, catalogRevision: revision });
    const result = await this.commit(plan, revision);
    if (!result.refreshed) {
      throw new Error('Workspace command was saved, but the command catalog could not be refreshed.');
    }
  }

  async deleteEntry(entry: SlashCatalogEntry, revision: number): Promise<PiviManagementMutationResult<AgentCommandDetail>> {
    return this.commit(await this.plan({ action: 'remove', id: entry.id, catalogRevision: revision }), revision);
  }

  async saveOrder(ids: readonly string[], revision: number): Promise<WorkspaceCommandSnapshot> {
    await this.withMutationLock(async () => {
      await this.refreshWithoutLock(); this.requireRevision(revision);
      const eligible = new Set(this.entries.map(entry => entry.id));
      if (ids.length !== eligible.size || new Set(ids).size !== ids.length || ids.some(id => !eligible.has(id))) {
        throw new PiviCommandsManagementError('state_changed', 'Command order no longer matches the current catalog.');
      }
      await this.persistOrder([...ids]);
      await this.refreshWithoutLock();
    });
    return { entries: this.currentEntries(), catalogRevision: this.revision };
  }

  async renameEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, revision: number): Promise<void> {
    await this.withMutationLock(async () => {
      await this.refreshWithoutLock(); this.requireRevision(revision);
      if (!isValidWorkspaceCommandId(entry.id)) {
        throw new PiviCommandsManagementError('invalid_input', 'Command id must be a path-safe slug.');
      }
      this.assertAvailable(entry.id);
      const existing = this.entries.find(candidate => candidate.id === previous.id);
      if (!existing || this.entries.some(candidate => candidate.id === entry.id && candidate.id !== previous.id)) {
        throw new PiviCommandsManagementError('state_changed', 'Command catalog changed; list commands and retry.');
      }
      const oldPath = existing.persistenceKey?.startsWith('legacy-template:') ? `${LEGACY_TEMPLATES_DIR}/${previous.id}.md` : `${COMMANDS_DIR}/${previous.id}.md`;
      const newPath = `${COMMANDS_DIR}/${entry.id}.md`;
      const backup = `${oldPath}.rename-${Date.now().toString(36)}`;
      const previousOrder = this.host.settings.workspaceCommandOrder;
      const nextOrder = previousOrder?.map(id => id === previous.id ? entry.id : id);
      let orderPersisted = false;
      const command: SlashCommand = { ...entry, kind: 'command', argumentHint: entry.argumentHint?.trim() || entry.name,
        integrationKey: existing.integrationKey ?? this.createKey() };
      await this.store.rename(oldPath, backup);
      try {
        await writeFileAtomically(this.store, newPath, serializeSlashCommandMarkdown(command, entry.content));
        if (nextOrder && !arraysEqual(nextOrder, previousOrder)) {
          await this.persistOrder(nextOrder);
          orderPersisted = true;
        }
        await this.store.delete(backup);
      } catch (error) {
        if (orderPersisted) {
          await this.persistOrder(previousOrder).catch(() => undefined);
        }
        if (await this.store.exists(newPath)) await this.store.delete(newPath).catch(() => undefined);
        await this.store.rename(backup, oldPath).catch(() => undefined);
        throw error;
      }
      await this.refreshWithoutLock();
    });
  }

  private async commitUpsert(input: Extract<WorkspaceCommandsMutation, { action: 'upsert' }>) {
    const existing = this.entries.find(entry => entry.id === input.id);
    const command: SlashCommand = { id: input.id, kind: 'command', name: input.id, description: input.description,
      argumentHint: input.argumentHint || input.id, icon: input.icon, content: input.content,
      integrationKey: existing?.integrationKey ?? this.createKey() };
    await writeFileAtomically(this.store, `${COMMANDS_DIR}/${input.id}.md`, serializeSlashCommandMarkdown(command, input.content));
    if (existing?.persistenceKey?.startsWith('legacy-template:')) {
      const legacy = `${LEGACY_TEMPLATES_DIR}/${input.id}.md`;
      if (await this.store.exists(legacy)) await this.store.delete(legacy);
    }
    return this.refreshResult(input.id);
  }

  private async commitRemove(id: string) {
    const cleanupFailed = await removeCommandFiles(this.store, id);
    const result = await this.refreshResult();
    return cleanupFailed ? { ...result, refreshed: false, warnings: ['Command was removed, but transaction cleanup failed.'],
      refreshFailures: [...(result.refreshFailures ?? []), { target: 'commands:cleanup', message: 'Transaction cleanup failed.' }] } : result;
  }

  private async commitMove(input: Extract<WorkspaceCommandsMutation, { action: 'move' }>) {
    const ids = this.entries.map(entry => entry.id);
    ids.splice(ids.indexOf(input.id), 1);
    const anchor = ids.indexOf(input.beforeId ?? input.afterId!);
    ids.splice(input.beforeId ? anchor : anchor + 1, 0, input.id);
    await this.persistOrder(ids);
    return this.refreshResult(input.id);
  }

  private async persistOrder(ids: readonly string[]): Promise<void> {
    const previous = this.host.settings.workspaceCommandOrder;
    this.host.settings.workspaceCommandOrder = [...ids];
    try { await this.host.saveSettings(); } catch (error) { this.host.settings.workspaceCommandOrder = previous; throw error; }
  }

  private async refreshResult(id?: string): Promise<PiviManagementMutationResult<AgentCommandDetail>> {
    try {
      await this.refreshWithoutLock();
      if (!id) return { saved: true, refreshed: true };
      const entry = this.entries.find(candidate => candidate.id === id);
      if (!entry) throw new PiviCommandsManagementError('not_found', `Command /${id} was not found.`);
      return { saved: true, refreshed: true, effective: { id: entry.id, name: entry.name, description: entry.description,
        argumentHint: entry.argumentHint, icon: entry.icon, scope: entry.scope, source: entry.source,
        isEditable: entry.isEditable, isDeletable: entry.isDeletable, content: entry.content } };
    } catch { return { saved: true, refreshed: false, refreshFailures: [{ target: 'commands:catalog', message: 'Runtime refresh failed.' }] }; }
  }

  async refresh(): Promise<void> {
    await this.withMutationLock(() => this.refreshWithoutLock());
  }

  /** Called by preparation and already-serialized mutations. */
  async refreshWithoutLock(): Promise<void> {
    await this.recoverTransactionsWithoutLock();
    const scan = await this.scanCatalog();
    this.acceptCatalogScan(scan.entries, scan.fingerprint);
  }

  async recoverTransactionsWithoutLock(): Promise<void> {
    await recoverCommandRemovalTransactions(this.store);
  }
  private requireRevision(expected: number): void {
    if (expected !== this.revision) throw new PiviCommandsManagementError('state_changed', 'Command catalog changed; list commands and retry.');
  }
  private assertAvailable(id: string): void {
    if (isReservedCommandId(id) || this.runtimeIds.has(id)) throw new PiviCommandsManagementError('not_eligible', `Command /${id} is not eligible for workspace management.`);
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PiviManagementError('cancelled', 'Command management was cancelled.');
}
