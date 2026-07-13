export type AppModelReadinessStatusKind =
  | 'ready'
  | 'missing-credential'
  | 'oauth-expired'
  | 'disabled'
  | 'unavailable';

export interface AppModelReadinessStatus {
  kind: AppModelReadinessStatusKind;
  label: string;
  description: string;
}

export interface AppModelTestResult {
  ok: boolean;
  detail: string;
}

export interface AppModelReadinessProvider {
  getStatus(
    model: string,
    settings: Record<string, unknown>,
  ): AppModelReadinessStatus;
  testModel(
    model: string,
    settings: Record<string, unknown>,
  ): Promise<AppModelTestResult>;
  testProvider?(
    providerId: string,
    settings: Record<string, unknown>,
  ): Promise<AppModelTestResult>;
}
