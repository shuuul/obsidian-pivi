export type RuntimeReadyListener = (ready: boolean) => void;
export type RuntimeReadyListenerErrorHandler = (error: unknown) => void;

export class RuntimeReadyState {
  private ready = false;
  private readonly listeners = new Set<RuntimeReadyListener>();

  constructor(
    private readonly onListenerError?: RuntimeReadyListenerErrorHandler,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  onReadyStateChange(listener: RuntimeReadyListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.listeners) {
      try {
        listener(ready);
      } catch (error) {
        this.onListenerError?.(error);
      }
    }
  }
}
