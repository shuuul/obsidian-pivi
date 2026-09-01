import { CUSTOM_PROMPT_MODULE_ID_PREFIX } from '@pivi/agent/prompt';
import type { PiviSettings } from '@pivi/agent/settings';
import { DEFAULT_PIVI_SETTINGS } from '@pivi/agent/settings/defaults';
import { PiviManagementError } from '@pivi/agent/tools';

import {
  createPromptCompositionCoordinator,
} from '@/app/runtime/PromptCompositionCoordinator';

function makeHost(overrides?: Partial<PiviSettings>): {
  settings: PiviSettings;
  saveSettings: jest.Mock;
} {
  const settings = {
    ...DEFAULT_PIVI_SETTINGS,
    promptModules: {},
    customPromptModules: [],
    ...overrides,
  } as PiviSettings;
  return {
    settings,
    saveSettings: jest.fn(async () => undefined),
  };
}

describe('PromptCompositionCoordinator', () => {
  it('lists core as locked and workflow as composable without confirmation', () => {
    const coordinator = createPromptCompositionCoordinator(makeHost());
    const listed = coordinator.queryList();

    expect(listed.catalogRevision).toBe(1);
    expect(listed.modules.find((module) => module.id === 'identity')).toMatchObject({
      kind: 'core',
      enabled: true,
      modified: false,
    });
    expect(listed.modules.find((module) => module.id === 'transcript-cleanup')).toMatchObject({
      kind: 'workflow',
      enabled: true,
    });
    expect(listed.modules.every((module) => !('body' in module))).toBe(true);
  });

  it('rejects core enable/body/restore/upsert/remove/move', () => {
    const coordinator = createPromptCompositionCoordinator(makeHost());
    const revision = coordinator.catalogRevision();

    expect(() => coordinator.plan({
      action: 'set_enabled', id: 'identity', enabled: false, catalogRevision: revision,
    })).toThrow(PiviManagementError);
    expect(() => coordinator.plan({
      action: 'set_body', id: 'identity', body: 'nope', catalogRevision: revision,
    })).toThrow(/Core prompt modules cannot be edited/);
    expect(() => coordinator.plan({
      action: 'restore', id: 'identity', catalogRevision: revision,
    })).toThrow(/Workflow prompt module/);
    expect(() => coordinator.plan({
      action: 'upsert', id: 'identity', title: 'x', catalogRevision: revision,
    })).toThrow(/cannot be upserted/);
    expect(() => coordinator.plan({
      action: 'remove', id: 'identity', catalogRevision: revision,
    })).toThrow(/cannot be removed/);
    expect(() => coordinator.plan({
      action: 'move', id: 'identity', beforeId: 'transcript-cleanup', catalogRevision: revision,
    })).toThrow(/cannot be reordered/);
  });

  it('creates, enables, reorders, and removes custom modules', async () => {
    const host = makeHost();
    const coordinator = createPromptCompositionCoordinator(host);

    const first = await coordinator.createCustomModule({ title: 'Alpha', body: 'A' });
    const second = await coordinator.createCustomModule({ title: 'Beta', body: 'B' });
    expect(first.id.startsWith(CUSTOM_PROMPT_MODULE_ID_PREFIX)).toBe(true);
    expect(host.settings.customPromptModules.map((entry) => entry.title)).toEqual(['Alpha', 'Beta']);

    const revision = coordinator.catalogRevision();
    await coordinator.commit(coordinator.plan({
      action: 'set_enabled',
      id: first.id,
      enabled: false,
      catalogRevision: revision,
    }), revision);
    expect(host.settings.customPromptModules[0]?.enabled).toBe(false);

    const movedRevision = coordinator.catalogRevision();
    await coordinator.commit(coordinator.plan({
      action: 'move',
      id: first.id,
      afterId: second.id,
      catalogRevision: movedRevision,
    }), movedRevision);
    expect(host.settings.customPromptModules.map((entry) => entry.title)).toEqual(['Beta', 'Alpha']);

    const removeRevision = coordinator.catalogRevision();
    await coordinator.commit(coordinator.plan({
      action: 'remove',
      id: second.id,
      catalogRevision: removeRevision,
    }), removeRevision);
    expect(host.settings.customPromptModules.map((entry) => entry.title)).toEqual(['Alpha']);
  });

  it('fails stale catalogRevision with state_changed and does not write', async () => {
    const host = makeHost();
    const coordinator = createPromptCompositionCoordinator(host);
    const stale = coordinator.catalogRevision();
    await coordinator.setWorkflowEnabled('transcript-cleanup', false);

    expect(() => coordinator.plan({
      action: 'set_enabled',
      id: 'transcript-cleanup',
      enabled: true,
      catalogRevision: stale,
    })).toThrow(/list or get again/);
    expect(host.settings.promptModules['transcript-cleanup']).toEqual({ enabled: false });
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('shares catalogRevision across coordinators on the same settings object', async () => {
    const host = makeHost();
    const settingsUi = createPromptCompositionCoordinator(host);
    const agent = createPromptCompositionCoordinator(host);

    expect(agent.catalogRevision()).toBe(1);
    await settingsUi.setWorkflowEnabled('transcript-cleanup', false);
    expect(agent.catalogRevision()).toBe(2);
    expect(() => agent.plan({
      action: 'restore',
      id: 'transcript-cleanup',
      catalogRevision: 1,
    })).toThrow(/list or get again/);
  });
});
