/** Narrow host surface for concrete Pi runtime adapters. */
export interface PiRuntimeHost {
  getVaultPath(): string | null;
  settings: Record<string, unknown> & {
    customContextLimits?: Record<string, number>;
    model?: string;
    titleGenerationModel?: string;
    userName?: string;
  };
}
