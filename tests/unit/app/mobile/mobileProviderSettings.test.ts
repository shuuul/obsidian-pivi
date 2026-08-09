import {
  deleteMobileProviderKey,
  saveMobileProviderSettings,
} from '@/app/composition/mobile/mobileProviderSettings';
import type { MobileWorkspace } from '@/app/composition/mobile/MobileWorkspace';

describe('mobileProviderSettings', () => {
  it('keeps two shared-vault devices independent and excludes credentials from shared diagnostics', () => {
    const sharedVault = new Map<string, string>();
    const makeDevice = (name: string) => {
      const secrets = new Map<string, string>();
      const local = new Map<string, unknown>();
      const workspace = {
        providers: {
          loadInitialized: jest.fn(() => local.get('providers') ?? null),
        },
        readCredential: jest.fn((id: string) => secrets.get(id)
          ? { type: 'api_key', key: secrets.get(id)! } : undefined),
        restoreCredential: jest.fn(),
        setApiKey: jest.fn((id: string, key: string) => { secrets.set(id, key); }),
        configureProvider: jest.fn((providerId: string, modelId: string) => {
          local.set('providers', { providerId, modelId, device: name });
        }),
        invalidateRuntimes: jest.fn(), notifySurfacesChanged: jest.fn(), deleteApiKey: jest.fn(),
      } as unknown as MobileWorkspace;
      return { workspace, secrets, local };
    };
    const a = makeDevice('A');
    const b = makeDevice('B');
    const sentinelA = 'shared-vault-sentinel-A';
    const sentinelB = 'shared-vault-sentinel-B';

    expect(saveMobileProviderSettings(a.workspace, {
      providerId: 'anthropic', modelId: 'a-model', apiKey: sentinelA,
    })).toEqual({ ok: true });
    expect(saveMobileProviderSettings(b.workspace, {
      providerId: 'openai', modelId: 'b-model', apiKey: sentinelB,
    })).toEqual({ ok: true });
    sharedVault.set('.pivi/session/local-diagnostic.json', JSON.stringify({ status: 'ready' }));

    expect(a.secrets.get('anthropic')).toBe(sentinelA);
    expect(b.secrets.get('openai')).toBe(sentinelB);
    expect(a.secrets.has('openai')).toBe(false);
    expect(b.secrets.has('anthropic')).toBe(false);
    expect(a.local.get('providers')).not.toEqual(b.local.get('providers'));
    for (const [path, value] of sharedVault) {
      expect(path.startsWith('.pivi/session')).toBe(true);
      expect(value).not.toContain(sentinelA);
      expect(value).not.toContain(sentinelB);
    }
  });

  it('writes SecretStorage before provider state, never keeps the key, and refreshes surfaces', () => {
    const order: string[] = [];
    const workspace = {
      providers: { loadInitialized: jest.fn(() => null) },
      readCredential: jest.fn(() => undefined),
      restoreCredential: jest.fn(),
      invalidateRuntimes: jest.fn(() => order.push('invalidate')),
      setApiKey: jest.fn((providerId: string, apiKey: string) => {
        order.push(`key:${providerId}:${apiKey}`);
      }),
      configureProvider: jest.fn((providerId: string, modelId: string) => {
        order.push(`provider:${providerId}/${modelId}`);
      }),
      notifySurfacesChanged: jest.fn(() => {
        order.push('refresh');
      }),
      deleteApiKey: jest.fn((providerId: string) => {
        order.push(`delete:${providerId}`);
      }),
    } as unknown as MobileWorkspace;

    const input = {
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'sk-sentinel-never-persist',
    };
    const result = saveMobileProviderSettings(workspace, input);
    expect(result).toEqual({ ok: true });
    expect(order).toEqual([
      'key:anthropic:sk-sentinel-never-persist',
      'provider:anthropic/claude-sonnet-4-5',
      'invalidate',
      'refresh',
    ]);
    // Caller must clear its local key; the helper does not store it on workspace.
    expect(workspace).not.toHaveProperty('apiKey');
    expect(JSON.stringify(workspace)).not.toContain('sk-sentinel-never-persist');

    jest.mocked(workspace.providers.loadInitialized).mockReturnValue({
      providers: [{ id: 'anthropic', type: 'builtin', disabled: false }],
      modelPreferences: { activeModel: 'anthropic/claude-sonnet-4-5' },
    } as never);
    const deleted = deleteMobileProviderKey(workspace, 'anthropic');
    expect(deleted).toEqual({ ok: true });
    expect(order.at(-3)).toBe('delete:anthropic');
    expect(order.at(-2)).toBe('invalidate');
    expect(order.at(-1)).toBe('refresh');
  });

  it('validates provider/model/key and surfaces secure-storage failures before provider writes', () => {
    const workspace = {
      providers: { loadInitialized: jest.fn(() => null) },
      readCredential: jest.fn(() => undefined),
      restoreCredential: jest.fn(),
      invalidateRuntimes: jest.fn(),
      setApiKey: jest.fn(() => {
        throw new Error('Secure storage is unavailable.');
      }),
      configureProvider: jest.fn(),
      notifySurfacesChanged: jest.fn(),
    } as unknown as MobileWorkspace;

    expect(saveMobileProviderSettings(workspace, {
      providerId: '',
      modelId: 'm',
      apiKey: 'k',
    })).toEqual({ ok: false, error: 'Provider is required.' });
    expect(saveMobileProviderSettings(workspace, {
      providerId: 'p',
      modelId: '',
      apiKey: 'k',
    })).toEqual({ ok: false, error: 'Model is required.' });
    expect(saveMobileProviderSettings(workspace, {
      providerId: 'p',
      modelId: 'm',
      apiKey: '',
    })).toEqual({ ok: false, error: 'API key is required.' });

    const failed = saveMobileProviderSettings(workspace, {
      providerId: 'p',
      modelId: 'm',
      apiKey: 'secret',
    });
    expect(failed).toEqual({ ok: false, error: 'Secure storage is unavailable.' });
    expect(workspace.configureProvider).not.toHaveBeenCalled();
    expect(workspace.notifySurfacesChanged).not.toHaveBeenCalled();
  });

  it('compensates the destination credential when local publication fails', () => {
    const oldCredential = { type: 'api_key', key: 'old' } as const;
    const workspace = {
      providers: { loadInitialized: jest.fn(() => null) },
      readCredential: jest.fn(() => oldCredential),
      setApiKey: jest.fn(),
      configureProvider: jest.fn(() => { throw new Error('local publication failed'); }),
      restoreCredential: jest.fn(),
      deleteApiKey: jest.fn(),
      invalidateRuntimes: jest.fn(),
      notifySurfacesChanged: jest.fn(),
    } as unknown as MobileWorkspace;

    expect(saveMobileProviderSettings(workspace, {
      providerId: 'anthropic', modelId: 'model', apiKey: 'new',
    })).toEqual({ ok: false, error: 'local publication failed' });
    expect(workspace.restoreCredential).toHaveBeenCalledWith('anthropic', oldCredential);
    expect(workspace.deleteApiKey).not.toHaveBeenCalled();
    expect(workspace.notifySurfacesChanged).not.toHaveBeenCalled();
  });

  it('publishes before clearing only the superseded active provider credential', () => {
    const order: string[] = [];
    const workspace = {
      providers: { loadInitialized: jest.fn(() => ({
        providers: [{ id: 'old', type: 'builtin', disabled: false }],
        modelPreferences: { activeModel: 'old/model' },
      })) },
      readCredential: jest.fn(() => undefined),
      setApiKey: jest.fn(() => order.push('destination-key')),
      configureProvider: jest.fn(() => order.push('publication')),
      restoreCredential: jest.fn(),
      invalidateRuntimes: jest.fn(() => order.push('invalidate')),
      notifySurfacesChanged: jest.fn(() => order.push('notify')),
      deleteApiKey: jest.fn((id: string) => order.push(`clear:${id}`)),
    } as unknown as MobileWorkspace;
    expect(saveMobileProviderSettings(workspace, {
      providerId: 'new', modelId: 'model', apiKey: 'key',
    })).toEqual({ ok: true });
    expect(order).toEqual([
      'destination-key', 'publication', 'invalidate', 'notify', 'clear:old',
    ]);
  });
});
