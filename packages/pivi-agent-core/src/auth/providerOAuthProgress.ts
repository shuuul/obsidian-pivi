/** User-visible message when an in-flight provider OAuth login is aborted. */
export const PROVIDER_OAUTH_LOGIN_CANCELLED = 'Login cancelled';

/** Whether an OAuth login failure was caused by an explicit user cancel. */
export function isProviderOAuthLoginCancelled(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false;
  }
  return cause.message === PROVIDER_OAUTH_LOGIN_CANCELLED
    || cause.name === 'AbortError'
    || cause.message === 'This operation was aborted';
}

/** Structured progress updates for interactive provider OAuth in settings. */
export type ProviderOAuthProgress =
  | { readonly kind: 'message'; readonly message: string }
  | { readonly kind: 'device_code'; readonly userCode: string; readonly verificationUri?: string }
  | { readonly kind: 'cleared' };
