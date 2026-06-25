import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';

import { ObsidianCredentialStore } from '../../../../src/pi/auth/ObsidianCredentialStore';
import {
  CODEX_OAUTH_PROVIDER_ID,
  normalizeCodexBrowserAuthUrl,
  ProviderOAuthService,
} from '../../../../src/pi/auth/ProviderOAuthService';
import { createMockApp } from '../../../helpers/mockApp';

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

describe('ProviderOAuthService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsius-provider-oauth-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates legacy Codex auth.json credentials into SecretStorage', () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const authDir = path.join(tempDir, '.obsius');
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
    const service = new ProviderOAuthService(app, store);

    expect(service.hasCodexAuth()).toBe(true);
    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'legacy-access',
      refresh: 'legacy-refresh',
    });
    expect(JSON.parse(fs.readFileSync(authPath, 'utf-8'))).toEqual({});
  });

  it('logs in through the direct Codex OAuth provider and stores credentials', async () => {
    const app = createMockApp({ vaultBasePath: tempDir });
    const store = new ObsidianCredentialStore(app.secretStorage);
    const service = new ProviderOAuthService(app, store);
    const originalOpen = window.open;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    window.open = jest.fn();
    try {
      await service.loginCodex();
    } finally {
      window.open = originalOpen;
      warnSpy.mockRestore();
    }

    expect(store.readSync(CODEX_OAUTH_PROVIDER_ID)).toMatchObject({
      type: 'oauth',
      access: 'mock-access',
      refresh: 'mock-refresh',
    });
    expect(childProcess.spawn).toHaveBeenCalled();
  });

  it('normalizes browser OAuth URL to current Codex CLI parameters', () => {
    const normalized = new URL(normalizeCodexBrowserAuthUrl(
      'https://auth.openai.com/oauth/authorize?scope=openid+profile+email+offline_access&originator=pi&state=test',
    ));

    expect(normalized.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke',
    );
    expect(normalized.searchParams.get('originator')).toBe('codex_cli_rs');
  });
});
