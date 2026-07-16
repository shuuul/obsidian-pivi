import { createPiAuthInteraction } from '@pivi/pivi-agent-core/engine/pi/piAuthInteraction';

describe('createPiAuthInteraction', () => {
  it('cancels a manual-code prompt from the service signal even when pi-ai supplies its own signal', async () => {
    const serviceController = new AbortController();
    const promptController = new AbortController();
    const interaction = createPiAuthInteraction({
      oauthHost: { openAuthUrl: async () => undefined },
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
