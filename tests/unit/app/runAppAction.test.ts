import { Notice } from 'obsidian';

import { t } from '@/app/i18n';
import { runAppAction } from '@/app/runAppAction';

describe('runAppAction', () => {
  it('returns synchronously and surfaces a rejected action as a logged Notice', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    const error = new Error('leaf failed');

    runAppAction(
      async () => {
        throw error;
      },
      'chat.tabs.failedCreateChat',
      'Failed to open a new Pivi tab',
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open a new Pivi tab'),
      error,
    );
    expect(Notice).toHaveBeenCalledWith(t('chat.tabs.failedCreateChat'));
    warn.mockRestore();
  });
});
