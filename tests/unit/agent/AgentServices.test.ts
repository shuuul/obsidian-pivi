import { AgentServices } from '../../../src/core/agent/AgentServices';
import { ensurePiAgentBootstrapped } from '../../setupPiAgent';

describe('AgentServices', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });

  it('returns the Pi display name', () => {
    expect(AgentServices.getDisplayName()).toBe('Pi');
  });

  it('returns Pi runtime capabilities', () => {
    const caps = AgentServices.getCapabilities();
    expect(caps.supportsPersistentRuntime).toBe(true);
    expect(caps.supportsFork).toBe(true);
    expect(caps.supportsRuntimeCommands).toBe(false);
  });
});
