/** Narrow host surface for concrete Pi runtime adapters. */
export interface PiRuntimeHost {
  getVaultPath(): string | null;
  settings: Record<string, unknown> & {
    model?: string;
    titleGenerationModel?: string;
    userName?: string;
    enableAutoCompact?: boolean;
    autoCompactThresholdRatio?: number;
    autoCompactKeepRecentTokens?: number;
  };
  getPiWorkspace?(): {
    providerOAuth?: { hasCodexAuth(): boolean } | null;
  } | null;
}
