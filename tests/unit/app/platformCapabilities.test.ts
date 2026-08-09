import {
  DESKTOP_PLATFORM_CAPABILITIES,
  MOBILE_PLATFORM_CAPABILITIES,
  resolvePiviPlatformCapabilities,
} from '@/app/platformCapabilities';

describe('Pivi platform capabilities', () => {
  it('keeps desktop host authorities enabled', () => {
    expect(resolvePiviPlatformCapabilities(false)).toBe(DESKTOP_PLATFORM_CAPABILITIES);
    expect(DESKTOP_PLATFORM_CAPABILITIES).toMatchObject({
      platform: 'desktop',
      processExecution: true,
      externalFileAccess: true,
      officialObsidianCli: true,
      stdioMcp: true,
      systemEnvironment: true,
      localNetwork: true,
    });
  });

  it('removes desktop host authorities on Mobile', () => {
    expect(resolvePiviPlatformCapabilities(true)).toBe(MOBILE_PLATFORM_CAPABILITIES);
    expect(MOBILE_PLATFORM_CAPABILITIES).toMatchObject({
      platform: 'mobile',
      processExecution: false,
      externalFileAccess: false,
      officialObsidianCli: false,
      stdioMcp: false,
      systemEnvironment: false,
      localNetwork: false,
    });
  });
});
