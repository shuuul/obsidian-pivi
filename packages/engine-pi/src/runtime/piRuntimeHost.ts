/** Narrow host surface for concrete Pi runtime adapters. */
export interface PiRuntimeHost {
  getVaultPath(): string | null;
  /** Host-localized warning shown after automatic compaction recovery is exhausted. */
  getCompactionRecoveryWarning?(): string;
  settings: Record<string, unknown> & {
    customContextLimits?: Record<string, number>;
    model?: string;
    providerRequestDeadlines?: { totalMs: number; idleMs: number };
    titleGenerationModel?: string;
    userName?: string;
  };
}
