/* eslint-disable no-console */
export class PluginLogger {
  constructor(private context: string) {}

  warn(message: string, error?: unknown): void {
    console.warn(`[Pivi:${this.context}] ${message}`, error ?? '');
  }

  error(message: string, error?: unknown): void {
    console.error(`[Pivi:${this.context}] ${message}`, error ?? '');
  }

  debug(message: string, ...args: unknown[]): void {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('PIVI_DEBUG') === 'true') {
      console.log(`[Pivi:${this.context}] ${message}`, ...args);
    }
  }
}
