import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { OAuthFlowHost, ProviderLegacyAuthData, ProviderLegacyAuthStore } from '@pivi/pivi-agent-core/ports';
import { createFileProviderLegacyAuthStore } from '@pivi/obsidian-host/providerLegacyAuthStore';
import { configurePiAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { ObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import {
  CODEX_OAUTH_PROVIDER_ID,
  XAI_PROVIDER_ID,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import {
  normalizeCodexBrowserAuthUrl,
  ProviderOAuthService,
} from '@pivi/pivi-agent-core/engine/pi/piProviderOAuthService';
import { createMockApp } from '../../../helpers/mockApp';

function createMockOAuthFlowHost(): OAuthFlowHost & { openAuthUrl: jest.Mock } {
  return {
    openAuthUrl: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ProviderOAuthService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-provider-oauth-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    configurePiAiModels({});
  });

  it('migrates legacy Codex auth.json credentials into SecretStorage', () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const authDir = path.join(tempDir, '.pivi');
    const authPath = path.join(authDir, 'auth.json');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        [CODEX_OAUTH_PROVIDER_ID]: {
          type: 'oauth',
          access: 'legacy-access',
          refresh: 'legacy-refresh',
          expires: Date.now() + 3600_000,
        },
      }),
    );

    const store = new ObsidianCredentialStore(app.secretStorage);
    const oauthHost = createMockOAuthFlowHost();
    const legacyAuthStore = createFileProviderLegacyAuthStore(authPath);
    const service = new ProviderOAuthService(store, oauthHost, legacyAuthStore);

    expect(service.hasCodexAuth()).toBe(true);
    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'legacy-access',
      refresh: 'legacy-refresh',
    });
    expect(JSON.parse(fs.readFileSync(authPath, 'utf-8'))).toEqual({});
  });

  it('migrates legacy Codex credentials from injected store read() into SecretStorage and writes back without the Codex entry', () => {
    const legacyCredential = {
      type: 'oauth' as const,
      access: 'injected-access',
      refresh: 'injected-refresh',
      expires: Date.now() + 3600_000,
    };
    let legacyData: ProviderLegacyAuthData = {
      [CODEX_OAUTH_PROVIDER_ID]: legacyCredential,
      'other-provider': { type: 'api_key', key: 'keep-me' },
    };
    const writes: ProviderLegacyAuthData[] = [];
    const fakeLegacyStore: ProviderLegacyAuthStore = {
      path: '/virtual/auth.json',
      read: () => ({ ...legacyData }),
      write: (data) => {
        writes.push(data);
        legacyData = { ...data };
      },
    };

    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost, fakeLegacyStore);

    expect(service.hasCodexAuth()).toBe(true);
    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'injected-access',
      refresh: 'injected-refresh',
    });
    expect(writes).toHaveLength(1);
    expect(legacyData).toEqual({ 'other-provider': { type: 'api_key', key: 'keep-me' } });
  });

  it('logs in through the direct Codex OAuth provider and stores credentials', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost);

    await service.loginCodex();

    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-access',
      refresh: 'mock-refresh',
    });
    expect(oauthHost.openAuthUrl).toHaveBeenCalledWith(
      normalizeCodexBrowserAuthUrl('https://auth.openai.com/oauth/authorize'),
    );
  });

  it('logs in through xAI device-code OAuth and stores credentials', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost);

    await service.loginProviderOAuth(XAI_PROVIDER_ID);

    expect(store.readSync(XAI_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-xai-access',
      refresh: 'mock-xai-refresh',
    });
    expect(oauthHost.openAuthUrl).toHaveBeenCalledWith('https://x.ai/device');
  });

  it('treats the injected legacy auth path as optional', () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost, createFileProviderLegacyAuthStore(null));

    expect(service.hasCodexAuth()).toBe(false);
    expect(service.getCodexAccessTokenSync()).toBeUndefined();
  });

  it('preserves pi-ai browser OAuth URL parameters', () => {
    const normalized = new URL(normalizeCodexBrowserAuthUrl(
      'https://auth.openai.com/oauth/authorize?scope=openid+profile+email+offline_access&originator=pi&state=test',
    ));

    expect(normalized.searchParams.get('scope')).toBe('openid profile email offline_access');
    expect(normalized.searchParams.get('originator')).toBe('pi');
    expect(normalized.searchParams.get('state')).toBe('test');
  });
});
