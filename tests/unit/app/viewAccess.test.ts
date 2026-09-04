import { refreshVaultSkillsViews } from '@/app/viewAccess';

describe('refreshVaultSkillsViews', () => {
  it('continues refreshing after a disposed view rejects', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refreshAfterFailure = jest.fn(async () => undefined);
    const views = [
      {
        getChatHandle: () => ({
          maintenance: {
            refreshVaultSkills: async () => { throw new Error('view disposed'); },
          },
        }),
      },
      {
        getChatHandle: () => ({
          maintenance: { refreshVaultSkills: refreshAfterFailure },
        }),
      },
    ] as never;

    await expect(refreshVaultSkillsViews(views)).resolves.toBeUndefined();
    expect(refreshAfterFailure).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      '[Pivi:PiviViewAccess] Failed to refresh vault skills in a Pivi view',
      expect.any(Error),
    );
  });
});
