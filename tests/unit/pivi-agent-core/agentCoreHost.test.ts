import type { AgentEngine } from '@pivi/pivi-agent-core/engine';
import type { SessionStore } from '@pivi/pivi-agent-core/session';
import {
  createCliProjectLikeHost,
  createObsidianLikeHost,
} from './agentCoreFakeHosts';

describe('AgentCoreHost contract', () => {
  it('exposes obsidian-vault workspace identity on a vault-shaped host', () => {
    const host = createObsidianLikeHost();

    expect(host.workspace).toEqual({
      id: 'vault-alpha',
      name: 'Research Vault',
      kind: 'obsidian-vault',
      rootUri: 'file:///vaults/alpha',
      piviDir: '.pivi',
    });
  });

  it('exposes cli-project workspace identity on a CLI-shaped host', () => {
    const host = createCliProjectLikeHost();

    expect(host.workspace).toEqual({
      id: 'repo-cli-42',
      name: 'pivi-cli',
      kind: 'cli-project',
      rootUri: 'file:///Users/dev/pivi-cli',
      piviDir: '.pivi',
    });
  });

  it('lets an obsidian-vault host use files, sessions, engine, and tools ports', async () => {
    const host = createObsidianLikeHost();
    const sessions = host.sessions as SessionStore & { listedVaultPath: string | null };
    const engine = host.engine as AgentEngine & { lastSyncPath: string | null };

    await host.files.write('notes/todo.md', '- [ ] ship');
    expect(await host.files.read('notes/todo.md')).toBe('- [ ] ship');

    const listed = await host.sessions.listSessions('/vaults/alpha');
    expect(sessions.listedVaultPath).toBe('/vaults/alpha');
    const [session] = listed;
    expect(session).toBeDefined();
    if (!session) throw new Error('Expected the vault session');
    expect(session.title).toBe('vault session');

    host.engine.syncSession({ sessionFile: session.sessionFile, leafId: null });
    expect(engine.lastSyncPath).toBe('vault/sessions/one.jsonl');

    const toolProvider = host.tools[0];
    expect(toolProvider).toBeDefined();
    if (!toolProvider) throw new Error('Expected the Obsidian tool provider');
    const tools = await toolProvider.listTools({ workspaceKind: host.workspace.kind });
    expect(tools.map((tool) => tool.name)).toEqual(['obsidian_search']);

    await host.secrets!.setSecret('api/token', 'vault-secret');
    expect(await host.secrets!.getSecret('api/token')).toBe('vault-secret');
    host.ui!.notify!('saved');
    expect(host.ui!.notify).toHaveBeenCalledWith('saved');
  });

  it('lets a cli-project host use different port implementations for the same contract', async () => {
    const host = createCliProjectLikeHost();
    const sessions = host.sessions as SessionStore & { listedVaultPath: string | null };
    const engine = host.engine as AgentEngine & { lastSyncPath: string | null };

    expect(await host.files.read('package.json')).toBe('{"name":"pivi-cli"}');

    const listed = await host.sessions.listSessions('/Users/dev/pivi-cli');
    expect(sessions.listedVaultPath).toBe('/Users/dev/pivi-cli');
    const [session] = listed;
    expect(session).toBeDefined();
    if (!session) throw new Error('Expected the CLI session');
    expect(session.title).toBe('cli session');

    host.engine.syncSession({ sessionFile: session.sessionFile, leafId: 'leaf-9' });
    expect(engine.lastSyncPath).toBe('cli/sessions/one.jsonl');

    const toolProvider = host.tools[0];
    expect(toolProvider).toBeDefined();
    if (!toolProvider) throw new Error('Expected the CLI tool provider');
    const tools = await toolProvider.listTools({ cwd: host.workspace.rootUri });
    expect(tools[0]?.name).toBe('bash');

    const response = await host.network!.fetch({ url: 'https://example.com/health', method: 'GET' });
    expect(response.status).toBe(200);

    const run = await host.process!.run({ command: 'echo', args: ['hi'], cwd: '/tmp' });
    expect(run.stdout).toBe('done');
    host.logger!.info?.('cli ready');
    expect(host.logger!.info).toHaveBeenCalledWith('cli ready');
  });

  it('allows two independently constructed hosts without sharing port state', async () => {
    const vaultHost = createObsidianLikeHost();
    const cliHost = createCliProjectLikeHost();

    expect(vaultHost.workspace.kind).toBe('obsidian-vault');
    expect(cliHost.workspace.kind).toBe('cli-project');
    expect(vaultHost.workspace.id).not.toBe(cliHost.workspace.id);

    await vaultHost.files.write('notes/only-vault.md', 'vault-only');
    await cliHost.files.write('src/main.ts', 'export {}');

    expect(await vaultHost.files.exists('notes/only-vault.md')).toBe(true);
    expect(await cliHost.files.exists('notes/only-vault.md')).toBe(false);
    expect(await cliHost.files.read('src/main.ts')).toBe('export {}');
  });
});