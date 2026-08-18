/** Tool-paused generation clock used to compute completed-turn tokens/s.
 * Elapsed starts on the first thinking/text token, not assistant_message_start,
 * so time-to-first-token does not dilute the rate. Thinking counts as generation.
 */
export class TurnGenerationClock {
  private outputTokens = 0;
  private elapsedMs = 0;
  private startedAt: number | null = null;

  reset(): void {
    this.outputTokens = 0;
    this.elapsedMs = 0;
    this.startedAt = null;
  }

  start(now: number): void {
    if (this.startedAt === null) {
      this.startedAt = now;
    }
  }

  pause(now: number): void {
    if (this.startedAt === null) {
      return;
    }
    this.elapsedMs += Math.max(0, now - this.startedAt);
    this.startedAt = null;
  }

  addOutputTokens(tokens: number): void {
    if (tokens > 0) {
      this.outputTokens += tokens;
    }
  }

  snapshot(now?: number): { outputTokens: number; generationElapsedMs: number } {
    let generationElapsedMs = this.elapsedMs;
    if (this.startedAt !== null && now !== undefined) {
      generationElapsedMs += Math.max(0, now - this.startedAt);
    }
    return { outputTokens: this.outputTokens, generationElapsedMs };
  }
}
