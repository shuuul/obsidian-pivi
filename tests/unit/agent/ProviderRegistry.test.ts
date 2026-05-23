import { ProviderRegistry } from '../../../src/core/agent/ProviderRegistry';
import { piProviderRegistration } from '../../../src/pi/registration';

describe('ProviderRegistry', () => {
  beforeAll(() => {
    ProviderRegistry.install(piProviderRegistration);
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
