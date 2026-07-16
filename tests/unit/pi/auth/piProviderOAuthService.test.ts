import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { OAuthFlowHost, ProviderLegacyAuthData, ProviderLegacyAuthStore } from '@pivi/pivi-agent-core/ports';
import { createFileProviderLegacyAuthStore } from '@pivi/obsidian-host/providerLegacyAuthStore';
import {
  isProviderOAuthLoginCancelled,
} from '@pivi/pivi-agent-core/auth/providerOAuthProgress';
import {
  ANTHROPIC_PROVIDER_ID,
  CLAUDE_PROVIDER_ID,
  CODEX_OAUTH_PROVIDER_ID,
  GROK_BUILD_PROVIDER_ID,
  XAI_PROVIDER_ID,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import { configurePiAiModels } from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { ObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
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

    await service.loginProviderOAuth(CODEX_OAUTH_PROVIDER_ID);

    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-access',
      refresh: 'mock-refresh',
    });
    expect(oauthHost.openAuthUrl).toHaveBeenCalledWith(
      normalizeCodexBrowserAuthUrl('https://auth.openai.com/oauth/authorize'),
    );
  });

  it('logs in through xAI device-code OAuth and stores credentials in the subscription slot', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost);

    await service.loginProviderOAuth(GROK_BUILD_PROVIDER_ID);

    expect(store.readSync(GROK_BUILD_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-xai-access',
      refresh: 'mock-xai-refresh',
    });
    expect(store.readSync(XAI_PROVIDER_ID)).toBeUndefined();
    expect(oauthHost.openAuthUrl).toHaveBeenCalledWith('https://x.ai/device?user_code=ABCD-1234');
  });

  it('logs in through Anthropic browser OAuth and stores credentials in the subscription slot', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost);

    await service.loginProviderOAuth(CLAUDE_PROVIDER_ID);

    expect(store.readSync(CLAUDE_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-access',
      refresh: 'mock-refresh',
    });
    expect(store.readSync(ANTHROPIC_PROVIDER_ID)).toBeUndefined();
    expect(oauthHost.openAuthUrl).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?client_id=test');
  });

  it('logs out a subscription without deleting the backing provider API key', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    store.writeSync(XAI_PROVIDER_ID, { type: 'api_key', key: 'xai-api-key' });
    store.writeSync(GROK_BUILD_PROVIDER_ID, {
      type: 'oauth',
      access: 'subscription-access',
      refresh: 'subscription-refresh',
      expires: Date.now() + 3600_000,
    });
    configurePiAiModels({ credentials: store });
    const service = new ProviderOAuthService(store, createMockOAuthFlowHost());

    await service.logoutProviderOAuth(GROK_BUILD_PROVIDER_ID);

    expect(store.readSync(GROK_BUILD_PROVIDER_ID)).toBeUndefined();
    expect(store.readSync(XAI_PROVIDER_ID)).toEqual({ type: 'api_key', key: 'xai-api-key' });
  });

  it('cancels an in-flight provider OAuth login', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const oauthHost = createMockOAuthFlowHost();
    const service = new ProviderOAuthService(store, oauthHost);

    const progress: Array<{ kind: string; userCode?: string }> = [];
    const loginPromise = service.loginProviderOAuth(
      GROK_BUILD_PROVIDER_ID,
      event => progress.push(event),
    ).catch((error: unknown) => error);
    await new Promise(resolve => setTimeout(resolve, 0));
    service.cancelProviderOAuthLogin(GROK_BUILD_PROVIDER_ID);
    const result = await loginPromise;
    expect(isProviderOAuthLoginCancelled(result)).toBe(true);
    expect(progress).toContainEqual({
      kind: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://x.ai/device?user_code=ABCD-1234',
    });
    expect(store.readSync(GROK_BUILD_PROVIDER_ID)).toBeUndefined();
  });

  it('cancels all in-flight provider OAuth logins on disposal', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    configurePiAiModels({ credentials: store });
    const service = new ProviderOAuthService(store, createMockOAuthFlowHost());

    const grokLogin = service.loginProviderOAuth(GROK_BUILD_PROVIDER_ID)
      .catch((error: unknown) => error);
    const claudeLogin = service.loginProviderOAuth(CLAUDE_PROVIDER_ID)
      .catch((error: unknown) => error);
    await new Promise(resolve => setTimeout(resolve, 0));

    service.dispose();

    const [grokResult, claudeResult] = await Promise.all([grokLogin, claudeLogin]);
    expect(isProviderOAuthLoginCancelled(grokResult)).toBe(true);
    expect(isProviderOAuthLoginCancelled(claudeResult)).toBe(true);
    expect(store.readSync(GROK_BUILD_PROVIDER_ID)).toBeUndefined();
    expect(store.readSync(CLAUDE_PROVIDER_ID)).toBeUndefined();
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
