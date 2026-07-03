import {
  PluginRegistry,
  createPluginLockfile,
  loadPluginContributions,
  parsePiviPluginManifest,
  type PluginResourceLoader,
  type SlashCommandContribution,
} from '@pivi/pivi-agent-core/plugins';

const explainCommand: SlashCommandContribution = {
  id: 'explain',
  kind: 'command',
  name: 'Explain',
  description: 'Explain this.',
  content: 'Explain this.',
  scope: 'runtime',
  source: 'plugin',
  isEditable: false,
  isDeletable: false,
  displayPrefix: '/',
  insertPrefix: '/',
};

describe('pivi-agent-core plugin registry', () => {
  it('parses declarative plugin manifests', () => {
    expect(parsePiviPluginManifest({
      id: 'demo-plugin',
      name: 'Demo plugin',
      version: '1.2.3',
      source: { kind: 'git', location: 'https://example.test/demo.git', ref: 'main' },
      resources: {
        skills: ['skills/review.md'],
        prompts: ['prompts/system.md'],
        mcpServers: ['mcp/github.json'],
      },
      capabilities: [{ id: 'network', description: 'Fetch remote resources', required: true }],
    })).toEqual({
      id: 'demo-plugin',
      name: 'Demo plugin',
      version: '1.2.3',
      source: { kind: 'git', location: 'https://example.test/demo.git', ref: 'main' },
      resources: {
        skills: ['skills/review.md'],
        prompts: ['prompts/system.md'],
        mcpServers: ['mcp/github.json'],
      },
      capabilities: [{ id: 'network', description: 'Fetch remote resources', required: true }],
    });
  });

  it('rejects manifests with executable or malformed resource declarations', () => {
    expect(() => parsePiviPluginManifest({
      id: 'bad-plugin',
      name: 'Bad plugin',
      source: { kind: 'shell', location: 'install.sh' },
      resources: { skills: ['skills/a.md'] },
    })).toThrow('Unsupported plugin source kind "shell".');

    expect(() => parsePiviPluginManifest({
      id: 'bad-plugin',
      name: 'Bad plugin',
      source: { kind: 'local', location: './plugin' },
      resources: { skills: ['skills/a.md', ''] },
    })).toThrow('Plugin manifest resources.skills must be an array of non-empty strings.');
  });

  it('tracks registry records and loads contributions only from enabled plugins', async () => {
    const firstManifest = parsePiviPluginManifest({
      id: 'enabled-plugin',
      name: 'Enabled plugin',
      source: { kind: 'local', location: './enabled' },
      resources: { commands: ['commands/explain.md'] },
    });
    const secondManifest = parsePiviPluginManifest({
      id: 'disabled-plugin',
      name: 'Disabled plugin',
      source: { kind: 'local', location: './disabled' },
      resources: { commands: ['commands/skip.md'] },
    });
    const registry = new PluginRegistry([
      { manifest: firstManifest, enabled: true },
      { manifest: secondManifest, enabled: false },
    ]);
    const loader: PluginResourceLoader = {
      loadManifest: jest.fn(),
      loadContribution: jest.fn(async (record) => ({
        pluginId: record.manifest.id,
        commands: [explainCommand],
      })),
    };

    await expect(loadPluginContributions(loader, registry.list())).resolves.toEqual([
      {
        pluginId: 'enabled-plugin',
        commands: [explainCommand],
      },
    ]);
    expect(loader.loadContribution).toHaveBeenCalledTimes(1);

    registry.setEnabled('disabled-plugin', true);
    expect(registry.enabledRecords().map((record) => record.manifest.id)).toEqual([
      'enabled-plugin',
      'disabled-plugin',
    ]);
  });

  it('creates versioned lockfiles without mutating input records', () => {
    const record = {
      pluginId: 'demo-plugin',
      source: { kind: 'npm' as const, location: '@pivi/demo-plugin', ref: '^1.0.0' },
      resolvedRef: '1.0.3',
      integrity: 'sha256-demo',
      enabledResources: { skills: ['skills/review.md'] },
      trust: { trusted: true, decidedAt: 1, decidedBy: 'test' },
    };

    expect(createPluginLockfile([record])).toEqual({
      version: 1,
      plugins: [record],
    });
  });
});
