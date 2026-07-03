export class PluginLogger {
  constructor(private context: string) {}

  warn(message: string, error?: unknown): void {
    console.warn(`[Pivi:${this.context}] ${message}`, error ?? '');
  }

  error(message: string, error?: unknown): void {
    console.error(`[Pivi:${this.context}] ${message}`, error ?? '');
  }

  debug(message: string, ...args: unknown[]): void {
    if (typeof activeWindow !== 'undefined' && activeWindow.localStorage.getItem('PIVI_DEBUG') === 'true') {
      console.warn(`[Pivi:${this.context}] ${message}`, ...args);
    }
  }
}
