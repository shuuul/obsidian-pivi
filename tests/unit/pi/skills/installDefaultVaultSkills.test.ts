import type { HttpClient, HttpRequest, HttpResponse, ProcessRunner } from '@pivi/pivi-agent-core/ports';
import * as fetchRemoteSha from '@pivi/pivi-agent-core/skills/vault/fetchDefaultVaultSkillsRemoteSha';
import {
  installDefaultVaultSkills,
  type DefaultVaultSkillsContext,
} from '@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills';
import * as notifyModule from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';

function mockHttpClient(): HttpClient {
  return {
    fetch: jest.fn(async (): Promise<HttpResponse> => ({
      ok: true,
      status: 200,
      headers: {},
      text: async () => '',
      json: async <T = unknown>() => ({ sha: 'ignored-by-spy' }) as T,
    })),
  };
}

describe('installDefaultVaultSkills', () => {
  const vaultPath = '/tmp/pivi-vault-test';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes context.httpClient into fetchDefaultVaultSkillsRemoteSha and stores returned sha', async () => {
    const httpClient = mockHttpClient();
    const fetchSpy = jest
      .spyOn(fetchRemoteSha, 'fetchDefaultVaultSkillsRemoteSha')
      .mockResolvedValue('upstream-sha-9');
    jest.spyOn(notifyModule, 'notifyVaultSkillsChanged').mockResolvedValue(undefined);
    jest.spyOn(VaultSkillsService.prototype, 'installFromSlug').mockResolvedValue(['obsidian-markdown']);

    const settings: DefaultVaultSkillsContext['settings'] = {};
    const saveSettings = jest.fn().mockResolvedValue(undefined);
    const plugin: DefaultVaultSkillsContext = {
      app: { vault: { adapter: { basePath: vaultPath } } },
      settings,
      saveSettings,
      getAllViews: () => [],
      httpClient,
      processRunner: { run: jest.fn() } as ProcessRunner,
    };

    await expect(installDefaultVaultSkills(plugin)).resolves.toEqual(['obsidian-markdown']);

    expect(fetchSpy).toHaveBeenCalledWith(httpClient);
    expect(settings.defaultVaultSkillsSeeded).toBe(true);
    expect(settings.defaultVaultSkillsCommitSha).toBe('upstream-sha-9');
    expect(saveSettings).toHaveBeenCalled();
  });
});