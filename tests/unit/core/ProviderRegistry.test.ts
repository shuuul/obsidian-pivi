import { ProviderRegistry } from '../../../src/core/providers/ProviderRegistry';
import { piProviderRegistration } from '../../../src/providers/pi/registration';

describe('ProviderRegistry', () => {
  beforeAll(() => {
    // Ensure Pi is registered
    ProviderRegistry.register('pi', piProviderRegistration);
  });

  it('should register the Pi provider successfully', () => {
    const registeredIds = ProviderRegistry.getRegisteredProviderIds();
    expect(registeredIds).toContain('pi');
  });

  it('should return correct display name', () => {
    expect(ProviderRegistry.getProviderDisplayName()).toBe('Pi');
  });

  it('should return correct capabilities', () => {
    const caps = ProviderRegistry.getCapabilities();
    expect(caps.providerId).toBe('pi');
    expect(caps.supportsPersistentRuntime).toBe(false);
  });
});
