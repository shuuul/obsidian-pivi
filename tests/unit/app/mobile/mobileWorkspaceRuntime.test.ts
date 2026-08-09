import { PiChatRuntime } from '@pivi/pivi-agent-core/engine/pi/piChatRuntime';
import { FileStoreSessionJsonlStorage } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';

import { MobileWorkspace } from '@/app/composition/mobile/MobileWorkspace';
import { isMobileRemoteProvider } from '@/app/composition/mobile/mobileProviderPolicy';
import { MOBILE_PLATFORM_CAPABILITIES } from '@/app/platformCapabilities';

let mockCredential: unknown = null;

jest.mock('@pivi/pivi-agent-core/engine/pi/piChatRuntime', () => ({
  PiChatRuntime: jest.fn().mockImplementation(() => ({
    cancel: jest.fn(),
    cleanup: jest.fn(),
    syncSession: jest.fn(),
    prepareTurn: jest.fn(),
    query: jest.fn(),
  })),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/piAiModels', () => ({
  configurePiAiModels: jest.fn(),
  piAiModels: {
    getModel: jest.fn((provider: string, modelId: string) => (
      provider === 'anthropic' && modelId === 'claude'
        ? { provider, id: modelId, name: 'Claude', contextWindow: 1 }
        : null
    )),
  },
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore', () => ({
  createObsidianCredentialStore: jest.fn(() => ({
    writeSync: jest.fn(),
    readSync: jest.fn((providerId: string) => (
      mockCredential instanceof Map ? mockCredential.get(providerId) : mockCredential
    )),
    listStoredSync: jest.fn(() => (
      mockCredential instanceof Map ? [...mockCredential.values()] : mockCredential ? [mockCredential] : []
    )),
    clearSync: jest.fn(),
  })),
}));

jest.mock('@pivi/obsidian-tools/mobile', () => ({
  createMobileVaultTools: jest.fn(() => [
    'obsidian_read', 'obsidian_markdown_structure', 'obsidian_search', 'obsidian_list',
    'obsidian_note_info', 'obsidian_links', 'obsidian_properties', 'obsidian_tags',
    'obsidian_graph', 'obsidian_write', 'obsidian_edit', 'obsidian_move',
    'obsidian_delete', 'obsidian_mkdir', 'obsidian_attachment',
  ].map(name => ({ name }))),
}));

jest.mock('@pivi/obsidian-host/mobile', () => ({
  MobileObsidianVaultApi: jest.fn(),
  ObsidianVaultFileAdapter: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage', () => ({
  FileStoreSessionJsonlStorage: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree', () => ({
  VaultPiSessionTreeFactory: jest.fn(),
}));

jest.mock('@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionStore', () => ({
  VaultPiSessionStore: jest.fn(),
}));

jest.mock('@/app/deviceLocalExternalContextStore', () => ({
  ObsidianDeviceLocalExternalContextStore: jest.fn(),
}));

jest.mock('@/app/deviceLocalProviderStore', () => ({
  ObsidianDeviceLocalProviderStore: jest.fn().mockImplementation(() => ({
    loadInitialized: jest.fn(() => ({
      version: 1,
      initialized: true,
      providers: [{ id: 'anthropic', type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: ['anthropic/claude'],
        activeModel: 'anthropic/claude',
        titleGenerationModel: 'anthropic/claude-title',
        customContextLimits: {},
      },
      webSearchTools: { providerOrder: [], disabledProviders: [] },
    })),
    save: jest.fn(),
  })),
}));

describe('MobileWorkspace.createChatRuntime / dispose', () => {
  function createApp() {
    return {
      vault: {
        adapter: {},
        getName: () => 'vault',
      },
      secretStorage: {
        getSecret: jest.fn(),
        setSecret: jest.fn(),
        listSecrets: jest.fn(() => []),
      },
      loadLocalStorage: jest.fn(),
      saveLocalStorage: jest.fn(),
      workspace: {
        getActiveFile: jest.fn(),
      },
    };
  }

  it('constructs PiChatRuntime with Mobile-safe defaults and tracks unload cleanup', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );

    const runtime = workspace.createChatRuntime();
    expect(PiChatRuntime).toHaveBeenCalledTimes(1);
    const [host, network, trees, mcpManager, mcpOAuth, baseTools, limiter, approval, mainOnly] =
      jest.mocked(PiChatRuntime).mock.calls[0]!;

    expect(host.getVaultPath()).toBeNull();
    expect(host.settings.model).toBe('anthropic/claude');
    expect(host.settings.titleGenerationModel).toBe('anthropic/claude-title');
    expect(host.settings).toMatchObject({
      agentSettings: {
        subagents: {
          enabled: false,
          maxConcurrentSubagents: 1,
          allowBackground: false,
        },
      },
    });
    expect(network.mcpProcessEnv).toEqual({});
    expect(mcpManager).toBeNull();
    expect(mcpOAuth).toBeNull();
    expect(baseTools).toBe(workspace.baseToolProvider);
    expect(limiter).toBeUndefined();
    expect(approval).toBeNull();
    expect(mainOnly).toBeNull();
    expect(trees).toBe(workspace.sessionTrees);

    const cancel = jest.mocked(runtime.cancel);
    const cleanup = jest.mocked(runtime.cleanup);
    workspace.dispose();
    expect(cancel).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(() => workspace.createChatRuntime()).toThrow(/disposed/i);
  });

  it('derives readiness from the active model provider and exact registered model', () => {
    mockCredential = { type: 'api_key', key: 'key' };
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    expect(workspace.readiness()).toMatchObject({
      provider: true, model: true, credential: true, ready: true,
    });

    const state = workspace.providers.loadInitialized()!;
    jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
      ...state,
      providers: [
        { id: 'anthropic', type: 'builtin', disabled: false },
        { id: 'deepseek', type: 'builtin', disabled: false },
      ],
      modelPreferences: { ...state.modelPreferences, activeModel: 'deepseek/not-real' },
    });
    expect(workspace.readiness()).toMatchObject({
      provider: true, model: false, ready: false,
    });

    jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
      ...state,
      providers: [{ id: 'deepseek', type: 'builtin', disabled: false }],
      modelPreferences: { ...state.modelPreferences, activeModel: 'anthropic/claude' },
    });
    expect(workspace.readiness()).toMatchObject({
      provider: false, model: false, credential: false, ready: false,
    });
  });

  it('sanitizes with provider B when provider A is registered first', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    const state = workspace.providers.loadInitialized()!;
    const sentinelA = 'provider-a-sentinel';
    const sentinelB = 'provider-b-sentinel';
    mockCredential = new Map([
      ['anthropic', { type: 'api_key', key: sentinelA }],
      ['deepseek', { type: 'api_key', key: sentinelB }],
    ]);
    jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
      ...state,
      providers: [
        { id: 'anthropic', type: 'builtin', disabled: false },
        { id: 'deepseek', type: 'builtin', disabled: false },
      ],
      modelPreferences: { ...state.modelPreferences, activeModel: 'deepseek/model' },
    });

    expect(workspace.sanitizeDiagnostic(`reopened ${sentinelB}`)).toBe('reopened [credential redacted]');
    expect(workspace.sanitizeDiagnostic(sentinelA)).toBe(sentinelA);
  });

  it('redacts credentials from raw session JSONL writes without changing field names', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    const sentinel = 'session-reflection-sentinel';
    workspace.setApiKey('anthropic', sentinel);
    const sanitizeWrite = jest.mocked(FileStoreSessionJsonlStorage).mock.calls.at(-1)?.[2];
    expect(sanitizeWrite).toBeDefined();

    const raw = `${JSON.stringify({ type: 'message', id: 'id', content: `reflected ${sentinel}` })}\n`;
    const sanitized = sanitizeWrite!(raw);

    expect(sanitized).not.toContain(sentinel);
    expect(JSON.parse(sanitized.trim())).toEqual({
      type: 'message', id: 'id', content: 'reflected [credential redacted]',
    });

    const escapedSentinel = 'quoted-"credential\\value';
    workspace.setApiKey('anthropic', escapedSentinel);
    const escaped = sanitizeWrite!(`${JSON.stringify({ content: escapedSentinel })}\n`);
    expect(escaped).not.toContain('quoted-');
    expect(JSON.parse(escaped.trim())).toEqual({ content: '[credential redacted]' });

    workspace.setApiKey('anthropic', 'abc');
    const unicodeEscaped = sanitizeWrite!('{"content":"\\u0061bc"}\n');
    expect(JSON.parse(unicodeEscaped.trim())).toEqual({ content: '[credential redacted]' });
    expect(() => sanitizeWrite!('{"\\u0061bc":"value"}\n'))
      .toThrow(/credential in an object key/i);

    workspace.setApiKey('anthropic', 'a/b');
    const slashEscaped = sanitizeWrite!('{"content":"a\\/b"}\n');
    expect(JSON.parse(slashEscaped.trim())).toEqual({ content: '[credential redacted]' });

    expect(() => sanitizeWrite!(`${JSON.stringify({ nested: { [sentinel]: 'value' } })}\n`))
      .toThrow(/credential in an object key/i);
  });

  it('fails closed when a credential collides with the redaction marker', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    workspace.setApiKey('anthropic', 'credential');
    const sanitizeWrite = jest.mocked(FileStoreSessionJsonlStorage).mock.calls.at(-1)?.[2];

    const sanitized = sanitizeWrite!('{"content":"credential"}\n');
    expect(sanitized).not.toContain('credential');
    expect(JSON.parse(sanitized.trim())).toEqual({ content: '' });
  });

  it('discovers unregistered stored credentials added after construction before writing', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    const sanitizeWrite = jest.mocked(FileStoreSessionJsonlStorage).mock.calls.at(-1)?.[2];
    mockCredential = new Map([
      ['unregistered-provider', { type: 'api_key', key: 'late-secret' }],
    ]);

    const sanitized = sanitizeWrite!('{"content":"late-secret"}\n');
    expect(sanitized).not.toContain('late-secret');
    expect(JSON.parse(sanitized.trim())).toEqual({ content: '[credential redacted]' });
  });

  it('remembers OAuth refresh values and externally inserted keys before deletion', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    const sanitizeWrite = jest.mocked(FileStoreSessionJsonlStorage).mock.calls.at(-1)?.[2];
    mockCredential = new Map([
      ['legacy-oauth', {
        type: 'oauth', access: 'access-secret', refresh: 'refresh-secret', expires: 1,
      }],
    ]);
    expect(JSON.parse(sanitizeWrite!('{"content":"refresh-secret"}\n').trim()))
      .toEqual({ content: '[credential redacted]' });

    mockCredential = new Map([
      ['anthropic', { type: 'api_key', key: 'deleted-secret' }],
    ]);
    workspace.deleteApiKey('anthropic');
    mockCredential = null;
    expect(JSON.parse(sanitizeWrite!('{"content":"deleted-secret"}\n').trim()))
      .toEqual({ content: '[credential redacted]' });
  });

  it('rejects OAuth, empty API keys, local providers, and non-HTTPS custom providers', () => {
    const workspace = new MobileWorkspace(
      createApp() as never,
      MOBILE_PLATFORM_CAPABILITIES,
      { approve: async () => true },
    );
    const state = workspace.providers.loadInitialized()!;
    mockCredential = { type: 'oauth', access: 'token' };
    expect(workspace.readiness().credential).toBe(false);
    mockCredential = { type: 'api_key', key: '   ' };
    expect(workspace.readiness().credential).toBe(false);

    for (const [kind, baseUrl] of [
      ['ollama', 'http://localhost:11434/v1'],
      ['openai-compatible', 'http://api.example.test/v1'],
    ] as const) {
      jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
        ...state,
        providers: [{
          id: 'anthropic', type: 'custom', disabled: false,
          config: {
            id: 'anthropic', kind, name: 'Custom', baseUrl,
            api: 'openai-completions', models: [{ id: 'claude', name: 'Claude' }],
          },
        }],
      });
      expect(workspace.readiness().provider).toBe(false);
    }

    jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
      ...state,
      providers: [{ id: 'claude', type: 'builtin', disabled: false }],
      modelPreferences: { ...state.modelPreferences, activeModel: 'claude/claude' },
    });
    expect(workspace.readiness().provider).toBe(false);
  });

  it.each([
    'https://localhost/v1', 'https://x.localhost/v1', 'https://127.0.0.1/v1',
    'https://10.0.0.1/v1', 'https://172.16.0.1/v1', 'https://192.168.1.1/v1',
    'https://169.254.1.1/v1', 'https://0.0.0.0/v1', 'https://100.64.0.1/v1',
    'https://[::1]/v1', 'https://[::]/v1', 'https://[fc00::1]/v1',
    'https://[fe80::1]/v1', 'https://[::ffff:127.0.0.1]/v1',
  ])('rejects Mobile custom provider local endpoint %s', baseUrl => {
    expect(isMobileRemoteProvider({
      id: 'custom', type: 'custom', disabled: false,
      config: {
        id: 'custom', kind: 'openai-compatible', name: 'Custom', baseUrl,
        api: 'openai-completions', models: [{ id: 'model', name: 'Model' }],
      },
    })).toBe(false);
  });

  it('accepts only a remote HTTPS custom provider literal policy', () => {
    expect(isMobileRemoteProvider({
      id: 'custom', type: 'custom', disabled: false,
      config: {
        id: 'custom', kind: 'openai-compatible', name: 'Custom',
        baseUrl: 'https://api.example.com/v1', api: 'openai-completions',
        models: [{ id: 'model', name: 'Model' }],
      },
    })).toBe(true);
  });
});
