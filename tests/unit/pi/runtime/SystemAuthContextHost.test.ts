import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createSystemAuthContextHost } from '@pivi/obsidian-host/AuthContextHost';
import { ObsidianAuthContext } from '@pivi/pivi-agent-core/engine/pi/PiProviderCredentialStore';
import { asPiviPlugin, createMockPiviPluginStub } from '../../../helpers/mockPiviPlugin';

const envKey = 'PIVI_SYSTEM_AUTH_CONTEXT_TEST_KEY';

describe('createSystemAuthContextHost', () => {
  let originalEnvValue: string | undefined;
  let originalHome: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalEnvValue = process.env[envKey];
    originalHome = process.env.HOME;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-auth-context-host-'));
  });

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = originalEnvValue;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads environment variables through the host adapter', () => {
    process.env[envKey] = 'system-env-value';

    expect(createSystemAuthContextHost().getEnvironmentVariable(envKey)).toBe('system-env-value');
  });

  it('checks files and resolves the home directory through the host adapter', () => {
    const filePath = path.join(tempDir, 'credential.json');
    fs.writeFileSync(filePath, '{}', 'utf-8');
    process.env.HOME = tempDir;

    const host = createSystemAuthContextHost();

    expect(host.fileExists(filePath)).toBe(true);
    expect(host.fileExists(path.join(tempDir, 'missing.json'))).toBe(false);
    expect(host.getHomeDirectory()).toBe(tempDir);
  });

  it('can back ObsidianAuthContext external env and file lookup', async () => {
    const filePath = path.join(tempDir, 'credential.json');
    fs.writeFileSync(filePath, '{}', 'utf-8');
    process.env[envKey] = 'external-env-value';
    process.env.HOME = tempDir;

    const plugin = asPiviPlugin(createMockPiviPluginStub());
    const ctx = new ObsidianAuthContext(plugin, createSystemAuthContextHost());

    await expect(ctx.env(envKey)).resolves.toBe('external-env-value');
    await expect(ctx.fileExists('~/credential.json')).resolves.toBe(true);
  });
});
