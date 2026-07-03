import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../shared/utils/animationFrame';

/** RAF-throttled render queue shared by streaming text and thinking blocks. */
export class StreamRenderQueue {
  private pendingFrame: ScheduledAnimationFrame | null = null;
  private pendingPromise: Promise<void> | null = null;
  private resolvePending: (() => void) | null = null;
  private isRunning = false;

  constructor(
    private readonly getRenderWindow: () => Window | undefined,
    private readonly render: () => Promise<void>,
    private readonly hasPendingContent: () => boolean,
  ) {}

  schedule(): Promise<void> {
    if (!this.pendingPromise) {
      this.pendingPromise = new Promise((resolve) => {
        this.resolvePending = resolve;
      });
    }

    if (this.pendingFrame === null && !this.isRunning) {
      this.pendingFrame = scheduleAnimationFrame(() => {
        this.pendingFrame = null;
        void this.runRenderPass();
      }, this.getRenderWindow());
    }

    return this.pendingPromise;
  }

  async flush(): Promise<void> {
    const pendingRender = this.pendingPromise;
    if (!pendingRender) {
      return;
    }

    if (this.pendingFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
      void this.runRenderPass();
    }

    await pendingRender;
  }

  cancel(): void {
    if (this.pendingFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingFrame);
      this.pendingFrame = null;
    }

    const resolve = this.resolvePending;
    this.pendingPromise = null;
    this.resolvePending = null;
    resolve?.();
  }

  private async runRenderPass(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      await this.render();
    } finally {
      this.isRunning = false;
    }

    if (this.hasPendingContent()) {
      this.pendingFrame = scheduleAnimationFrame(() => {
        this.pendingFrame = null;
        void this.runRenderPass();
      }, this.getRenderWindow());
      return;
    }

    const resolve = this.resolvePending;
    this.pendingPromise = null;
    this.resolvePending = null;
    resolve?.();
  }
}
