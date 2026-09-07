/** Narrow host surface for concrete Pi runtime adapters. */
export interface PiRuntimeHost {
  getVaultPath(): string | null;
  /** Host-localized warning shown after automatic compaction recovery is exhausted. */
  getCompactionRecoveryWarning?(): string;
  /** Host-localized notice when a continuation is blocked because context would overflow. */
  getContinuationBlockedWarning?(): string;
  settings: Record<string, unknown> & {
    customContextLimits?: Record<string, number>;
    model?: string;
    providerRequestDeadlines?: { totalMs: number; idleMs: number };
    titleGenerationModel?: string;
    userName?: string;
  };
}
