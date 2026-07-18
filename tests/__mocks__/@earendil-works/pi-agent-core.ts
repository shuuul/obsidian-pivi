export class Agent {
  constructor(_options?: any) {}
  async prompt(_message: any): Promise<void> {}
  async continue(): Promise<void> {}
  abort(): void {}
  reset(): void {}
  subscribe(_listener: (event: any, signal?: AbortSignal) => void | Promise<void>): () => void {
    return () => {};
  }
  get sessionId(): string | undefined { return undefined; }
}
