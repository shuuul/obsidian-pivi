import {
  CONFIG_DIR_NAME,
  configurePiCodingAgentConfigHost,
  ENV_AGENT_DIR,
  getAgentDir,
  getBinDir,
  getSessionsDir,
  resetPiCodingAgentConfigHost,
} from '@pivi/pivi-agent-core/engine/pi/shims/piCodingAgentConfig';

describe('piCodingAgentConfig host seams', () => {
  afterEach(() => {
    resetPiCodingAgentConfigHost();
  });

  it('uses the injected agent directory environment override', () => {
    configurePiCodingAgentConfigHost({
      getEnvironmentVariable: (name) => (name === ENV_AGENT_DIR ? '/override/agent' : undefined),
      getHomeDirectory: () => '/home/test',
      joinPath: (...segments) => segments.join('/'),
    });

    expect(getAgentDir()).toBe('/override/agent');
    expect(getSessionsDir()).toBe('/override/agent/sessions');
    expect(getBinDir()).toBe('/override/agent/bin');
  });

  it('builds default directories from injected home and join behavior', () => {
    const joined: string[][] = [];
    configurePiCodingAgentConfigHost({
      getEnvironmentVariable: () => undefined,
      getHomeDirectory: () => '/home/test',
      joinPath: (...segments) => {
        joined.push(segments);
        return segments.join('::');
      },
    });

    expect(getAgentDir()).toBe(`/home/test::${CONFIG_DIR_NAME}::agent`);
    expect(getSessionsDir()).toBe(`/home/test::${CONFIG_DIR_NAME}::agent::sessions`);
    expect(getBinDir()).toBe(`/home/test::${CONFIG_DIR_NAME}::agent::bin`);
    expect(joined).toContainEqual(['/home/test', CONFIG_DIR_NAME, 'agent']);
  });

  it('resets injected behavior to the default host', () => {
    configurePiCodingAgentConfigHost({
      getEnvironmentVariable: (name) => (name === ENV_AGENT_DIR ? '/override/agent' : undefined),
    });
    expect(getAgentDir()).toBe('/override/agent');

    resetPiCodingAgentConfigHost();

    expect(getAgentDir()).not.toBe('/override/agent');
  });
});
