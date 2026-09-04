import { formatUnexpectedConsole } from '../setupWindow';

describe('test console guard', () => {
  it.each(['warn', 'error'] as const)('formats an unhandled console.%s call', (method) => {
    expect(formatUnexpectedConsole(method, ['unhandled signal', { owner: 'test' }])).toBe(
      `Unexpected console.${method}: unhandled signal {"owner":"test"}`,
    );
  });

  it('allows an expected warning to be mocked and asserted explicitly', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    console.warn('expected signal');

    expect(warning).toHaveBeenCalledWith('expected signal');
  });
});
