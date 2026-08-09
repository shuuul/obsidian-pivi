export interface SubagentConcurrencyLease {
  maxConcurrentSubagents: number;
  queuePosition: number | null;
  queued: boolean;
  runningAtRequest: number;
  runningAtStart: number;
  release(): void;
}

interface QueuedAdmission {
  queuePosition: number;
  runningAtRequest: number;
  resolve: (lease: SubagentConcurrencyLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export class SubagentConcurrencyLimiter {
  private activeCount = 0;
  private disposed = false;
  private readonly queue: QueuedAdmission[] = [];

  constructor(private readonly getMaxConcurrentSubagents: () => number) {}

  acquire(signal?: AbortSignal): Promise<SubagentConcurrencyLease> {
    if (this.disposed) {
      return Promise.reject(new Error('Subagent concurrency limiter is disposed'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('Cancelled'));
    }

    const maxConcurrent = this.readMaxConcurrent();
    if (this.activeCount < maxConcurrent && this.queue.length === 0) {
      const runningAtRequest = this.activeCount;
      this.activeCount += 1;
      return Promise.resolve(this.createLease(false, null, runningAtRequest));
    }

    return new Promise<SubagentConcurrencyLease>((resolve, reject) => {
      const admission: QueuedAdmission = {
        queuePosition: this.queue.length + 1,
        runningAtRequest: this.activeCount,
        resolve,
        reject,
        signal,
      };
      if (signal) {
        admission.abortHandler = () => {
          const index = this.queue.indexOf(admission);
          if (index < 0) {
            return;
          }
          this.queue.splice(index, 1);
          reject(new Error('Cancelled'));
        };
        signal.addEventListener('abort', admission.abortHandler, { once: true });
      }
      this.queue.push(admission);
    });
  }

  getSnapshot(): { maxConcurrentSubagents: number; queuedSubagents: number; runningSubagents: number } {
    return {
      maxConcurrentSubagents: this.readMaxConcurrent(),
      queuedSubagents: this.queue.length,
      runningSubagents: this.activeCount,
    };
  }

  refreshCapacity(): void {
    if (this.disposed) {
      return;
    }
    this.drainQueue();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const admission of this.queue.splice(0)) {
      if (admission.abortHandler) {
        admission.signal?.removeEventListener('abort', admission.abortHandler);
      }
      admission.reject(new Error('Subagent concurrency limiter is disposed'));
    }
  }

  private createLease(
    queued: boolean,
    queuePosition: number | null,
    runningAtRequest: number,
  ): SubagentConcurrencyLease {
    let released = false;
    return {
      maxConcurrentSubagents: this.readMaxConcurrent(),
      queuePosition,
      queued,
      runningAtRequest,
      runningAtStart: this.activeCount,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.activeCount -= 1;
        if (!this.disposed) {
          this.drainQueue();
        }
      },
    };
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.activeCount < this.readMaxConcurrent()) {
      const admission = this.queue.shift()!;
      if (admission.abortHandler) {
        admission.signal?.removeEventListener('abort', admission.abortHandler);
      }
      if (admission.signal?.aborted) {
        admission.reject(new Error('Cancelled'));
        continue;
      }
      this.activeCount += 1;
      admission.resolve(this.createLease(true, admission.queuePosition, admission.runningAtRequest));
    }
  }

  private readMaxConcurrent(): number {
    const configured = this.getMaxConcurrentSubagents();
    return Number.isInteger(configured) && configured > 0 ? configured : 1;
  }
}
