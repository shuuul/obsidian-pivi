export class PluginLogger {
  constructor(private context: string) {}

  warn(message: string, error?: unknown): void {
    console.warn(`[Pivi:${this.context}] ${message}`, error ?? '');
  }

  error(message: string, error?: unknown): void {
    console.error(`[Pivi:${this.context}] ${message}`, error ?? '');
  }
}
