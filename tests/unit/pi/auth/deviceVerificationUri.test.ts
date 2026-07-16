import { selectDeviceVerificationUri } from '@pivi/pivi-agent-core/engine/pi';

describe('selectDeviceVerificationUri', () => {
  it('prefers verification_uri_complete over verification_uri', () => {
    expect(selectDeviceVerificationUri(
      'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234',
      'https://accounts.x.ai/oauth2/device',
    )).toBe('https://accounts.x.ai/oauth2/device?user_code=ABCD-1234');
  });

  it('falls back to verification_uri when complete is missing', () => {
    expect(selectDeviceVerificationUri(
      undefined,
      'https://accounts.x.ai/oauth2/device',
    )).toBe('https://accounts.x.ai/oauth2/device');
  });

  it('falls back to verification_uri when complete is blank', () => {
    expect(selectDeviceVerificationUri(
      '   ',
      'https://accounts.x.ai/oauth2/device',
    )).toBe('https://accounts.x.ai/oauth2/device');
  });

  it('returns undefined when both URIs are missing', () => {
    expect(selectDeviceVerificationUri(undefined, undefined)).toBeUndefined();
  });
});
