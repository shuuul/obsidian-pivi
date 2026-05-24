import { PiAgentServices } from '../../../src/core/agent/PiAgentServices';
import { ensurePiAgentBootstrapped } from '../../setupPiAgent';

describe('PiAgentServices', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });

  it('returns the Pi display name', () => {
    expect(PiAgentServices.getDisplayName()).toBe('Pi');
  });

  it('returns Pi runtime capabilities', () => {
    const caps = PiAgentServices.getCapabilities();
    expect(caps.supportsPersistentRuntime).toBe(true);
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsRuntimeCommands).toBe(false);
  });
});
