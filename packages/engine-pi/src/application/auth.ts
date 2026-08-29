/** Stable Pi authentication composition surface for production app code. */
export {
  type LegacyProviderMembershipSnapshot,
  migrateMembershipAwareProviderSecrets,
} from '../auth/membershipAwareCredentialMigration';
export {
  createObsidianCredentialStore,
  getPiAiCredentialSecretId,
  migratePiProviderCredentialsToKeychain,
  ObsidianAuthContext,
  type ObsidianCredentialStore,
} from '../auth/piProviderCredentialStore';
