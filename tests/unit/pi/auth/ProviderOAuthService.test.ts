import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ObsidianCredentialStore } from '../../../../src/pi/auth/ObsidianCredentialStore';
import { CODEX_OAUTH_PROVIDER_ID, ProviderOAuthService } from '../../../../src/pi/auth/ProviderOAuthService';
import { createMockApp } from '../../../helpers/mockApp';

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
});
