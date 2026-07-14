import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';

describe('PluginLogger', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('logs %s messages without a placeholder error argument', (method, consoleMethod) => {
    const spy = jest.spyOn(console, consoleMethod).mockImplementation(() => undefined);

    new PluginLogger('Test')[method]('Something happened');

    expect(spy).toHaveBeenCalledWith('[Pivi:Test] Something happened');
  });

  it.each([
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('logs %s messages with their error value', (method, consoleMethod) => {
    const spy = jest.spyOn(console, consoleMethod).mockImplementation(() => undefined);
    const error = new Error('failure');

    new PluginLogger('Test')[method]('Something happened', error);

    expect(spy).toHaveBeenCalledWith('[Pivi:Test] Something happened', error);
  });
});
