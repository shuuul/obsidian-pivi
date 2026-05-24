import { PiAgentServices } from '../../../src/core/agent/PiAgentServices';
import { bootstrapPiAgent } from '../../../src/pi/bootstrap';

describe('PiAgentServices', () => {
  beforeAll(() => {
    bootstrapPiAgent();
  });

  it('returns the Pi display name', () => {
    expect(PiAgentServices.getDisplayName()).toBe('Pi');
  });

  it('returns Pi runtime capabilities', () => {
    const caps = PiAgentServices.getCapabilities();
    expect(caps.supportsPersistentRuntime).toBe(false);
    expect(caps.supportsRuntimeCommands).toBe(true);
  });
});
