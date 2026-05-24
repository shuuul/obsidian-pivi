import { AgentServices } from '../../../src/core/agent/AgentServices';
import { bootstrapPiAgent } from '../../../src/pi/bootstrap';

describe('AgentServices', () => {
  beforeAll(() => {
    bootstrapPiAgent();
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
