import {
  createCustomPromptModuleId,
  type CustomPromptModule,
  getShippedPromptModule,
  isShippedPromptModuleId,
  normalizePromptModuleSettings,
  type PromptModuleOverride,
  type PromptModuleSettings,
  resolvePromptModules,
} from '@pivi/agent/prompt';
import type { PiviSettings } from '@pivi/agent/settings';
import {
  type AgentPromptModuleDetail,
  type AgentPromptModuleSummary,
  PiviManagementError,
  type PiviManagementMutationResult,
  type PiviPromptGetResult,
  type PiviPromptInput,
  type PiviPromptListResult,
} from '@pivi/agent/tools/piviManagement';

export type PromptCompositionMutation = Extract<PiviPromptInput, { catalogRevision: number }>;

export interface PromptCompositionPlan {
  readonly revision: number;
  readonly mutation: PromptCompositionMutation;
}

export interface PromptCompositionHost {
  settings: PiviSettings;
  saveSettings(): Promise<void>;
}

const CATALOG_REVISIONS = new WeakMap<object, number>();

function currentRevision(settings: object): number {
  return CATALOG_REVISIONS.get(settings) ?? 1;
}

function bumpRevision(settings: object): number {
  const current = currentRevision(settings);
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Prompt composition catalog revision space is exhausted.');
  }
  const next = current + 1;
  CATALOG_REVISIONS.set(settings, next);
  return next;
}

function toSummary(
  module: ReturnType<typeof resolvePromptModules>[number],
): AgentPromptModuleSummary {
  return {
    id: module.id,
    kind: module.kind,
    title: module.title,
    enabled: module.enabled,
    modified: module.kind === 'core' ? false : module.modified,
  };
}

function toDetail(
  module: ReturnType<typeof resolvePromptModules>[number],
): AgentPromptModuleDetail {
  return { ...toSummary(module), body: module.body };
}

function requireModule(
  settings: PromptModuleSettings,
  id: string,
): ReturnType<typeof resolvePromptModules>[number] {
  const module = resolvePromptModules(settings.promptModules, settings.customPromptModules)
    .find((entry) => entry.id === id);
  if (!module) {
    throw new PiviManagementError('validation_failed', `Prompt module ${id} was not found.`);
  }
  return module;
}

function requireWorkflow(id: string): void {
  const shipped = getShippedPromptModule(id);
  if (!shipped || shipped.kind !== 'workflow') {
    throw new PiviManagementError(
      'validation_failed',
      `Workflow prompt module ${id} was not found.`,
    );
  }
}

function requireCustom(settings: PromptModuleSettings, id: string): CustomPromptModule {
  const entry = settings.customPromptModules.find((module) => module.id === id);
  if (!entry) {
    throw new PiviManagementError(
      'validation_failed',
      `Custom prompt module ${id} was not found.`,
    );
  }
  return entry;
}

function writeOverride(
  current: PromptModuleSettings,
  id: string,
  patch: PromptModuleOverride,
): Record<string, PromptModuleOverride> {
  const shipped = getShippedPromptModule(id);
  const existing = current.promptModules[id] ?? {};
  const next: { enabled?: boolean; customBody?: string } = {};
  const enabled = patch.enabled ?? existing.enabled;
  const customBody = Object.hasOwn(patch, 'customBody') ? patch.customBody : existing.customBody;
  if (enabled !== undefined && shipped && enabled !== shipped.defaultEnabled) {
    next.enabled = enabled;
  }
  if (customBody !== undefined) {
    next.customBody = customBody;
  }
  const overrides = { ...current.promptModules };
  if (next.enabled === undefined && next.customBody === undefined) {
    delete overrides[id];
  } else {
    overrides[id] = next;
  }
  return overrides;
}

function rejectCore(module: ReturnType<typeof requireModule>, message: string): void {
  if (module.kind === 'core') {
    throw new PiviManagementError('validation_failed', message);
  }
}

function applySetEnabled(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'set_enabled' }>,
): PromptModuleSettings {
  const module = requireModule(current, mutation.id);
  rejectCore(module, 'Core prompt modules cannot be disabled.');
  if (module.kind === 'workflow') {
    requireWorkflow(mutation.id);
    return {
      promptModules: writeOverride(current, mutation.id, { enabled: mutation.enabled }),
      customPromptModules: current.customPromptModules,
    };
  }
  requireCustom(current, mutation.id);
  return {
    promptModules: current.promptModules,
    customPromptModules: current.customPromptModules.map((entry) => (
      entry.id === mutation.id ? { ...entry, enabled: mutation.enabled } : entry
    )),
  };
}

function applySetBody(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'set_body' }>,
): PromptModuleSettings {
  const module = requireModule(current, mutation.id);
  rejectCore(module, 'Core prompt modules cannot be edited.');
  if (module.kind === 'workflow') {
    requireWorkflow(mutation.id);
    return {
      promptModules: writeOverride(current, mutation.id, { customBody: mutation.body }),
      customPromptModules: current.customPromptModules,
    };
  }
  requireCustom(current, mutation.id);
  return {
    promptModules: current.promptModules,
    customPromptModules: current.customPromptModules.map((entry) => (
      entry.id === mutation.id ? { ...entry, body: mutation.body } : entry
    )),
  };
}

function applyRestore(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'restore' }>,
): PromptModuleSettings {
  requireWorkflow(mutation.id);
  const existing = current.promptModules[mutation.id];
  const overrides = { ...current.promptModules };
  if (!existing || existing.enabled === undefined) {
    delete overrides[mutation.id];
  } else {
    overrides[mutation.id] = { enabled: existing.enabled };
  }
  return {
    promptModules: overrides,
    customPromptModules: current.customPromptModules,
  };
}

function applyUpsert(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'upsert' }>,
): PromptModuleSettings {
  if (mutation.id === undefined) {
    const entry: CustomPromptModule = {
      id: createCustomPromptModuleId(),
      title: mutation.title?.trim() || 'New module',
      body: mutation.body ?? '',
      enabled: mutation.enabled ?? true,
    };
    return {
      promptModules: current.promptModules,
      customPromptModules: [...current.customPromptModules, entry],
    };
  }
  if (isShippedPromptModuleId(mutation.id)) {
    throw new PiviManagementError(
      'validation_failed',
      'Shipped prompt modules cannot be upserted; use set_enabled, set_body, or restore.',
    );
  }
  requireCustom(current, mutation.id);
  return {
    promptModules: current.promptModules,
    customPromptModules: current.customPromptModules.map((entry) => {
      if (entry.id !== mutation.id) {
        return entry;
      }
      return {
        ...entry,
        ...(mutation.title !== undefined ? { title: mutation.title } : {}),
        ...(mutation.body !== undefined ? { body: mutation.body } : {}),
        ...(mutation.enabled !== undefined ? { enabled: mutation.enabled } : {}),
      };
    }),
  };
}

function applyRemove(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'remove' }>,
): PromptModuleSettings {
  if (isShippedPromptModuleId(mutation.id)) {
    throw new PiviManagementError(
      'validation_failed',
      'Shipped prompt modules cannot be removed.',
    );
  }
  requireCustom(current, mutation.id);
  return {
    promptModules: current.promptModules,
    customPromptModules: current.customPromptModules.filter((entry) => entry.id !== mutation.id),
  };
}

function applyMove(
  current: PromptModuleSettings,
  mutation: Extract<PromptCompositionMutation, { action: 'move' }>,
): PromptModuleSettings {
  if (isShippedPromptModuleId(mutation.id)) {
    throw new PiviManagementError(
      'validation_failed',
      'Shipped prompt modules cannot be reordered.',
    );
  }
  requireCustom(current, mutation.id);
  const custom = [...current.customPromptModules];
  const fromIndex = custom.findIndex((entry) => entry.id === mutation.id);
  const moving = custom.splice(fromIndex, 1)[0];
  if (!moving) {
    throw new PiviManagementError('validation_failed', `Custom prompt module ${mutation.id} was not found.`);
  }
  const anchorId = mutation.beforeId ?? mutation.afterId;
  if (!anchorId) {
    throw new PiviManagementError('validation_failed', 'move requires exactly one of beforeId or afterId.');
  }
  if (isShippedPromptModuleId(anchorId)) {
    throw new PiviManagementError(
      'validation_failed',
      'Custom prompt modules can only move relative to other custom modules.',
    );
  }
  const anchorIndex = custom.findIndex((entry) => entry.id === anchorId);
  if (anchorIndex < 0) {
    throw new PiviManagementError(
      'validation_failed',
      `Custom prompt module ${anchorId} was not found.`,
    );
  }
  const insertAt = mutation.beforeId ? anchorIndex : anchorIndex + 1;
  custom.splice(insertAt, 0, moving);
  return {
    promptModules: current.promptModules,
    customPromptModules: custom,
  };
}

function applyMutation(
  current: PromptModuleSettings,
  mutation: PromptCompositionMutation,
): PromptModuleSettings {
  switch (mutation.action) {
    case 'set_enabled':
      return applySetEnabled(current, mutation);
    case 'set_body':
      return applySetBody(current, mutation);
    case 'restore':
      return applyRestore(current, mutation);
    case 'upsert':
      return applyUpsert(current, mutation);
    case 'remove':
      return applyRemove(current, mutation);
    case 'move':
      return applyMove(current, mutation);
  }
}

export function createPromptCompositionCoordinator(
  host: PromptCompositionHost,
): PromptCompositionCoordinator {
  return new PromptCompositionCoordinator(host);
}

export class PromptCompositionCoordinator {
  constructor(private readonly host: PromptCompositionHost) {}

  read(): PromptModuleSettings {
    return normalizePromptModuleSettings(
      this.host.settings.promptModules,
      this.host.settings.customPromptModules,
    );
  }

  catalogRevision(): number {
    return currentRevision(this.host.settings);
  }

  listModules(): ReturnType<typeof resolvePromptModules> {
    const settings = this.read();
    return resolvePromptModules(settings.promptModules, settings.customPromptModules);
  }

  queryList(): PiviPromptListResult {
    return {
      catalogRevision: this.catalogRevision(),
      modules: this.listModules().map(toSummary),
    };
  }

  queryGet(id: string): PiviPromptGetResult {
    const module = requireModule(this.read(), id);
    return {
      catalogRevision: this.catalogRevision(),
      module: toDetail(module),
    };
  }

  async persist(next: PromptModuleSettings): Promise<void> {
    this.host.settings.promptModules = { ...next.promptModules };
    this.host.settings.customPromptModules = next.customPromptModules.map((entry) => ({ ...entry }));
    await this.host.saveSettings();
    bumpRevision(this.host.settings);
  }

  async apply(next: PromptModuleSettings): Promise<void> {
    await this.persist(next);
  }

  plan(input: PromptCompositionMutation): PromptCompositionPlan {
    if (input.catalogRevision !== this.catalogRevision()) {
      throw new PiviManagementError(
        'state_changed',
        'Prompt composition changed; list or get again and retry with the new catalogRevision.',
      );
    }
    applyMutation(this.read(), input);
    return {
      revision: this.catalogRevision(),
      mutation: input,
    };
  }

  async commit(
    plan: PromptCompositionPlan,
    expectedRevision: number,
  ): Promise<PiviManagementMutationResult<{ catalogRevision: number }>> {
    if (expectedRevision !== this.catalogRevision()) {
      throw new PiviManagementError(
        'state_changed',
        'Prompt composition changed; list or get again and retry with the new catalogRevision.',
      );
    }
    const next = applyMutation(this.read(), plan.mutation);
    await this.persist(next);
    return {
      saved: true,
      refreshed: false,
      effective: { catalogRevision: this.catalogRevision() },
    };
  }

  async setWorkflowEnabled(id: string, enabled: boolean): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'set_enabled',
      id,
      enabled,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async saveCustomBody(id: string, customBody: string): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'set_body',
      id,
      body: customBody,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async restoreShipped(id: string): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'restore',
      id,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async createCustomModule(input?: { title?: string; body?: string; enabled?: boolean }): Promise<AgentPromptModuleDetail> {
    await this.persist(applyMutation(this.read(), {
      action: 'upsert',
      title: input?.title,
      body: input?.body ?? '',
      enabled: input?.enabled,
      catalogRevision: this.catalogRevision(),
    }));
    const created = this.listModules().filter((module) => module.kind === 'custom').at(-1);
    if (!created) {
      throw new PiviManagementError('persistence_failed', 'Custom prompt module was not created.');
    }
    return toDetail(created);
  }

  async renameCustomModule(id: string, title: string): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'upsert',
      id,
      title,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async editCustomModule(id: string, body: string): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'set_body',
      id,
      body,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async reorderCustomModules(ids: readonly string[]): Promise<void> {
    const current = this.read();
    const byId = new Map(current.customPromptModules.map((entry) => [entry.id, entry]));
    const next: CustomPromptModule[] = [];
    for (const id of ids) {
      if (isShippedPromptModuleId(id)) {
        continue;
      }
      const entry = byId.get(id);
      if (entry) {
        next.push(entry);
        byId.delete(id);
      }
    }
    for (const entry of byId.values()) {
      next.push(entry);
    }
    await this.persist({
      promptModules: current.promptModules,
      customPromptModules: next,
    });
  }

  async setCustomModuleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'set_enabled',
      id,
      enabled,
      catalogRevision: this.catalogRevision(),
    }));
  }

  async deleteCustomModule(id: string): Promise<void> {
    await this.persist(applyMutation(this.read(), {
      action: 'remove',
      id,
      catalogRevision: this.catalogRevision(),
    }));
  }
}
