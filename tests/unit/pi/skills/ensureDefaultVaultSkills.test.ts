import {
  type DefaultVaultSkillsContext,
  ensureDefaultVaultSkills,
  shouldSeedDefaultVaultSkills,
  shouldUpgradeDefaultVaultSkills,
} from '@pivi/pivi-agent-core/skills/vault/ensureDefaultVaultSkills';

describe('shouldSeedDefaultVaultSkills', () => {
  it('returns true when not seeded and no skills installed', () => {
    expect(shouldSeedDefaultVaultSkills({}, 0)).toBe(true);
    expect(shouldSeedDefaultVaultSkills({ defaultVaultSkillsSeeded: undefined }, 0)).toBe(true);
  });

  it('returns false when already seeded', () => {
    expect(shouldSeedDefaultVaultSkills({ defaultVaultSkillsSeeded: true }, 0)).toBe(false);
    expect(shouldSeedDefaultVaultSkills({ defaultVaultSkillsSeeded: true }, 3)).toBe(false);
  });

  it('returns false when the user dismissed the startup prompt', () => {
    expect(shouldSeedDefaultVaultSkills({ defaultVaultSkillsPromptDismissed: true }, 0)).toBe(false);
  });

  it('returns false when skills already exist even if not seeded', () => {
    expect(shouldSeedDefaultVaultSkills({}, 1)).toBe(false);
  });
});

describe('shouldUpgradeDefaultVaultSkills', () => {
  it('returns false when not seeded', () => {
    expect(shouldUpgradeDefaultVaultSkills({}, 'abc123')).toBe(false);
  });

  it('returns false when commit sha matches remote', () => {
    expect(
      shouldUpgradeDefaultVaultSkills(
        { defaultVaultSkillsSeeded: true, defaultVaultSkillsCommitSha: 'abc123' },
        'abc123',
      ),
    ).toBe(false);
  });

  it('returns true when seeded and remote sha differs', () => {
    expect(
      shouldUpgradeDefaultVaultSkills(
        { defaultVaultSkillsSeeded: true, defaultVaultSkillsCommitSha: 'old' },
        'new',
      ),
    ).toBe(true);
  });

  it('returns true when seeded but commit sha was never stored', () => {
    expect(
      shouldUpgradeDefaultVaultSkills({ defaultVaultSkillsSeeded: true }, 'new'),
    ).toBe(true);
  });
});

describe('ensureDefaultVaultSkills', () => {
  it('delegates the install prompt to the host and persists dismissal', async () => {
    let actions: Parameters<NonNullable<DefaultVaultSkillsContext['showDefaultVaultSkillsInstallPrompt']>>[0] | undefined;
    const hide = jest.fn();
    const saveSettings = jest.fn(async () => undefined);
    const settings: DefaultVaultSkillsContext['settings'] = {};
    const context = {
      app: { vault: { adapter: { basePath: '/tmp/pivi-missing-skills-test' } } },
      settings,
      saveSettings,
      refreshVaultSkills: jest.fn(async () => undefined),
      showDefaultVaultSkillsInstallPrompt: jest.fn((nextActions) => {
        actions = nextActions;
        return { hide };
      }),
      httpClient: { fetch: jest.fn() },
      processRunner: { run: jest.fn() },
    } as unknown as DefaultVaultSkillsContext;

    await ensureDefaultVaultSkills(context);
    expect(context.showDefaultVaultSkillsInstallPrompt).toHaveBeenCalledTimes(1);
    actions?.onDismiss();
    await Promise.resolve();

    expect(hide).toHaveBeenCalledTimes(1);
    expect(settings.defaultVaultSkillsPromptDismissed).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });
});
