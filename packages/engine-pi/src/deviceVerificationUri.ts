/**
 * Choose the browser verification URL for RFC 8628 device flows.
 *
 * Mirrors CLIProxyAPI: prefer `verification_uri_complete`, otherwise fall back to
 * `verification_uri`. Does not manually append `user_code`.
 */
export function selectDeviceVerificationUri(
  verificationUriComplete: string | undefined | null,
  verificationUri: string | undefined | null,
): string | undefined {
  const complete = verificationUriComplete?.trim();
  if (complete) {
    return complete;
  }
  const base = verificationUri?.trim();
  return base || undefined;
}
