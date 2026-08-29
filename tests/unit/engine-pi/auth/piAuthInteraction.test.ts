import { createPiAuthInteraction } from '@pivi/engine-pi/piAuthInteraction';

describe('createPiAuthInteraction', () => {
  it('delegates manual-code input to the OAuth host', async () => {
    const requestManualCode = jest.fn().mockResolvedValue('pasted-code');
    const interaction = createPiAuthInteraction({
      oauthHost: {
        openAuthUrl: async () => undefined,
        requestManualCode,
      },
    });

    await expect(interaction.prompt({
      type: 'manual_code',
      message: 'Paste code',
    })).resolves.toBe('pasted-code');
    expect(requestManualCode).toHaveBeenCalledWith('Paste code', expect.any(AbortSignal));
  });

  it('cancels a manual-code prompt from the service signal even when pi-ai supplies its own signal', async () => {
    const serviceController = new AbortController();
    const promptController = new AbortController();
    const interaction = createPiAuthInteraction({
      oauthHost: {
        openAuthUrl: async () => undefined,
        requestManualCode: (_message, signal) => new Promise(resolve => {
          signal.addEventListener('abort', () => resolve(null), { once: true });
        }),
      },
      signal: serviceController.signal,
    });
    const result = interaction.prompt({
      type: 'manual_code',
      message: 'Paste code',
      signal: promptController.signal,
    }).catch((error: unknown) => error);

    serviceController.abort(new Error('service cancelled'));

    await expect(result).resolves.toMatchObject({ message: 'service cancelled' });
  });
});
