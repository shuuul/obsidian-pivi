import {
  createSettingsSkillsPort,
} from '@/app/ui/createSettingsSkillsPort';
import type { PiviSettingsHost } from '@/app/hostContracts';
import type { SkillsManagementCoordinator } from '@pivi/agent/skills/vault/skillsManagementCoordinator';

describe('createSettingsSkillsPort', () => {
  it('notifies when a saved mutation has partial post-save failures', async () => {
    const notify = jest.fn();
    const host = {
      settings: {},
      notify,
      getVaultPath: () => '/tmp/pivi-skills-settings',
      refreshVaultSkills: jest.fn().mockResolvedValue(undefined),
    } as unknown as PiviSettingsHost;
    const coordinator = {
      execute: jest.fn().mockResolvedValue({
        revision: 'next',
        skills: [],
        refreshed: false,
        warnings: ['Skills were saved, but some post-save refresh work failed.'],
        refreshFailures: [{ target: 'skills:runtime', message: 'Runtime refresh failed.' }],
      }),
      snapshot: jest.fn(() => ({ revision: 'current', skills: [] })),
    } as unknown as SkillsManagementCoordinator;

    const port = createSettingsSkillsPort(host, coordinator);
    await port.install('owner/repo');

    expect(notify).toHaveBeenCalledWith(
      'Skills were saved, but some follow-up work failed.',
    );
    expect(host.refreshVaultSkills).toHaveBeenCalled();
  });
});
