import type { CapabilityApprovalPort } from '@pivi/agent/ports';
import {
  CapabilityPersistentGrantCache,
  createCapabilityApprovalPort,
} from '@pivi/agent/runtime/capabilitySessionGrants';
import { createCommandTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps(
  commandAllowlist: string[] = [],
  allowCommand = false,
  capabilityApproval: CapabilityApprovalPort | null = null,
): ObsidianToolDeps {
  return {
    cli: { run: jest.fn().mockResolvedValue('ok') },
    settings: { commandAllowlist, allowCommand },
    vaultName: 'vault',
    capabilityApproval,
  } as never;
}

describe('createCommandTool', () => {
  it('preserves id-only execution and executes an existing exact grant', async () => {
    const deps = makeDeps(['workspace:split'], true);
    const tool = createCommandTool(deps);

    await tool.execute('call', { id: 'workspace:split' });
    expect(deps.cli.run).toHaveBeenCalledTimes(1);
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['command', 'id=workspace:split'],
    });
  });

  it('denies execution when disabled without requesting approval', async () => {
    const capabilityApproval: CapabilityApprovalPort = {
      hasPersistentGrant: jest.fn(() => false),
      requestApproval: jest.fn(async () => ({ decision: 'allow-once' as const })),
    };
    await expect(createCommandTool(makeDeps(['workspace:split'])).execute('call', { id: 'workspace:split' }))
      .rejects.toThrow('Command execution is disabled');
    await expect(createCommandTool(makeDeps([], false, capabilityApproval)).execute('call', { id: 'workspace:split' }))
      .rejects.toThrow('Command execution is disabled');
    expect(capabilityApproval.requestApproval).not.toHaveBeenCalled();
  });

  it('requests approval for an unlisted command and executes after Allow once', async () => {
    const capabilityApproval: CapabilityApprovalPort = {
      hasPersistentGrant: jest.fn(() => false),
      requestApproval: jest.fn(async () => ({ decision: 'allow-once' as const })),
    };
    const deps = makeDeps([], true, capabilityApproval);

    await createCommandTool(deps).execute('call', { id: 'workspace:split' });

    expect(capabilityApproval.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'obsidian-command',
      commandId: 'workspace:split',
      toolName: 'obsidian_command',
    }));
    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['command', 'id=workspace:split'],
    });
  });

  it('does not execute after Deny or cancel', async () => {
    for (const decision of ['deny', 'cancel'] as const) {
      const capabilityApproval: CapabilityApprovalPort = {
        hasPersistentGrant: () => false,
        requestApproval: jest.fn(async () => ({ decision })),
      };
      const deps = makeDeps([], true, capabilityApproval);
      await expect(createCommandTool(deps).execute('call', { id: 'workspace:split' }))
        .rejects.toThrow('denied by user');
      expect(deps.cli.run).not.toHaveBeenCalled();
    }
  });

  it('persists Always for only the exact command id', async () => {
    const stored: string[] = [];
    const present = jest.fn()
      .mockResolvedValueOnce({ decision: 'allow-always' })
      .mockResolvedValue({ decision: 'deny' });
    const capabilityApproval = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      persistence: {
        persistObsidianCommand: async commandId => { stored.push(commandId); },
        getObsidianCommands: () => stored,
      },
      present,
    });
    const deps = makeDeps([], true, capabilityApproval);
    const tool = createCommandTool(deps);

    await tool.execute('call', { id: 'workspace:split' });
    await tool.execute('call', { id: 'workspace:split' });
    await expect(tool.execute('call', { id: 'workspace:split-right' }))
      .rejects.toThrow('denied by user');

    expect(stored).toEqual(['workspace:split']);
    expect(present).toHaveBeenCalledTimes(2);
    expect(deps.cli.run).toHaveBeenCalledTimes(2);
  });

  it('discovers command ids with an optional prefix filter', async () => {
    const capabilityApproval: CapabilityApprovalPort = {
      hasPersistentGrant: jest.fn(() => false),
      requestApproval: jest.fn(async () => ({ decision: 'deny' as const })),
    };
    const deps = makeDeps([], false, capabilityApproval);

    await createCommandTool(deps).execute('call', { action: 'list', filter: 'editor:' });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['commands', 'filter=editor:'],
    });
    expect(capabilityApproval.requestApproval).not.toHaveBeenCalled();
  });

  it('reads one hotkey without applying the execution allowlist', async () => {
    const deps = makeDeps(['allowed-only']);

    await createCommandTool(deps).execute('call', {
      action: 'hotkey',
      id: 'editor:toggle-bold',
      verbose: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['hotkey', 'id=editor:toggle-bold', 'verbose'],
    });
  });

  it('lists hotkeys as agent-friendly JSON with supported flags', async () => {
    const deps = makeDeps();

    await createCommandTool(deps).execute('call', {
      action: 'hotkeys',
      verbose: true,
      total: true,
      all: true,
    });

    expect(deps.cli.run).toHaveBeenCalledWith({
      vaultName: 'vault',
      args: ['hotkeys', 'format=json', 'verbose', 'total', 'all'],
    });
  });

  it('requires id only for execute and hotkey actions', async () => {
    const deps = makeDeps();
    const tool = createCommandTool(deps);

    await expect(tool.execute('call', { action: 'execute' })).rejects.toThrow('id is required for execute');
    await expect(tool.execute('call', { action: 'hotkey' })).rejects.toThrow('id is required for hotkey');
    await expect(tool.execute('call', { action: 'remove' })).rejects.toThrow('Invalid command action');
    expect(deps.cli.run).not.toHaveBeenCalled();
  });
});
