import { AgentServices } from '../../../src/core/agent/AgentServices';
import { piAgentAdaptor } from '../../../src/pi/registration';

describe('AgentServices', () => {
  beforeAll(() => {
    AgentServices.install(piAgentAdaptor);
  });

  it('returns the Pi display name', () => {
    expect(AgentServices.getDisplayName()).toBe('Pi');
  });

  it('returns Pi runtime capabilities', () => {
    const caps = AgentServices.getCapabilities();
    expect(caps.supportsPersistentRuntime).toBe(false);
    expect(caps.supportsRuntimeCommands).toBe(true);
  });
});
