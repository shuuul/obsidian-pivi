import { getCustomProviderHeaderSecretId } from '@pivi/pivi-agent-core/auth/customProviderHeaderSecrets';
import {
  getPiAiCredentialSecretId,
  INTERACTIVE_OAUTH_PROVIDER_IDS,
  SUBSCRIPTION_OAUTH_PROVIDER_IDS,
} from '@pivi/pivi-agent-core/auth/piProviderCredentials';
import {
  getProviderCredentialSecretId,
  isObsidianSecretId,
  MAX_OBSIDIAN_SECRET_ID_LENGTH,
} from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import { SUPPORTED_PI_PROVIDER_IDS } from '@pivi/pivi-agent-core/auth/piProviderValidation';
import {
  createCustomProviderId,
  FIXED_LOCAL_PROVIDER_IDS,
  LOCAL_CUSTOM_PROVIDER_KINDS,
  MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS,
} from '@pivi/pivi-agent-core/foundation/customProviders';
import { WEB_PROVIDER_IDS } from '@pivi/pivi-agent-core/foundation/settings';
import { getMcpAuthEntrySecretId } from '@pivi/pivi-agent-core/mcp/oauth/mcpSecretAuthStore';
import { getWebSearchCredentialSecretId } from '@pivi/pivi-agent-core/tools';

const LONG_CUSTOM_PROVIDER_ID = 'custom-openai-compatible-369e807a-7e24-4204-a86d-3abbaaa3d1e2';
const LONG_MCP_SERVER_NAME = 'my-very-long-mcp-server-name-example';

describe('Obsidian secret ID limits', () => {
  it('keeps built-in provider credential ids within the keychain limit', () => {
    const providerIds = [
      ...SUPPORTED_PI_PROVIDER_IDS,
      ...INTERACTIVE_OAUTH_PROVIDER_IDS,
      ...SUBSCRIPTION_OAUTH_PROVIDER_IDS,
      ...Object.values(FIXED_LOCAL_PROVIDER_IDS),
    ];

    for (const providerId of providerIds) {
      expect(getPiAiCredentialSecretId(providerId).length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
      expect(isObsidianSecretId(getPiAiCredentialSecretId(providerId))).toBe(true);
    }
  });

  it('keeps new multi-instance custom provider credential ids within the keychain limit', () => {
    for (const kind of MULTI_INSTANCE_CUSTOM_PROVIDER_KINDS) {
      const providerId = createCustomProviderId(kind, []);
      expect(getPiAiCredentialSecretId(providerId).length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
      expect(isObsidianSecretId(getPiAiCredentialSecretId(providerId))).toBe(true);
    }
  });

  it('uses digest credential ids for legacy long custom provider ids', () => {
    const secretId = getPiAiCredentialSecretId(LONG_CUSTOM_PROVIDER_ID);
    expect(secretId).toMatch(/^pivi-cp-cred-[0-9a-f]{16}$/);
    expect(secretId.length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
  });

  it('keeps web search credential ids within the keychain limit', () => {
    for (const providerId of WEB_PROVIDER_IDS) {
      expect(getWebSearchCredentialSecretId(providerId).length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
      expect(isObsidianSecretId(getWebSearchCredentialSecretId(providerId))).toBe(true);
    }
  });

  it('keeps legacy provider slot ids within the keychain limit for built-in providers', () => {
    for (const providerId of SUPPORTED_PI_PROVIDER_IDS) {
      expect(getProviderCredentialSecretId(providerId, 'api-key').length)
        .toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
      expect(getProviderCredentialSecretId(providerId, 'oauth-token').length)
        .toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
    }
  });

  it('uses digest header secret ids for long custom provider ids', () => {
    const secretId = getCustomProviderHeaderSecretId(LONG_CUSTOM_PROVIDER_ID);
    expect(secretId).toMatch(/^pivi-cph-[0-9a-f]{16}-v1$/);
    expect(secretId.length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
  });

  it('keeps short custom provider header ids on the legacy encoding path', () => {
    const secretId = getCustomProviderHeaderSecretId('my-openai');
    expect(secretId).toMatch(/^pivi-custom-provider-headers-[0-9a-f]+-v1$/);
    expect(secretId.length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
  });

  it('uses digest MCP OAuth ids for long server names', () => {
    const secretId = getMcpAuthEntrySecretId(LONG_MCP_SERVER_NAME);
    expect(secretId).toMatch(/^pivi-mcp-oauth-d-[0-9a-f]{16}-auth-v1$/);
    expect(secretId.length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
  });

  it('keeps local custom provider kinds within credential limits', () => {
    for (const kind of LOCAL_CUSTOM_PROVIDER_KINDS) {
      const providerId = createCustomProviderId(kind, []);
      expect(getPiAiCredentialSecretId(providerId).length).toBeLessThanOrEqual(MAX_OBSIDIAN_SECRET_ID_LENGTH);
    }
  });
});
