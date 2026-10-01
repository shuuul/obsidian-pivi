export interface AuxQueryConfig {
  systemPrompt: string;
  model?: string;
  abortController?: AbortController;
}

export interface AuxQueryRunner {
  query(config: AuxQueryConfig, prompt: string): Promise<string>;
  reset(): void;
}
