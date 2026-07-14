import { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";

describe("SubagentConcurrencyLimiter", () => {
  it("removes an aborted queued admission without consuming the next slot", async () => {
    const limiter = new SubagentConcurrencyLimiter(() => 1);
    const active = await limiter.acquire();
    const controller = new AbortController();
    const cancelled = limiter.acquire(controller.signal);
    const next = limiter.acquire();

    controller.abort();
    await expect(cancelled).rejects.toThrow("Cancelled");
    expect(limiter.getSnapshot()).toMatchObject({
      queuedSubagents: 1,
      runningSubagents: 1,
    });

    active.release();
    const admitted = await next;
    expect(admitted.queued).toBe(true);
    expect(limiter.getSnapshot()).toMatchObject({
      queuedSubagents: 0,
      runningSubagents: 1,
    });
    admitted.release();
  });

  it("drains FIFO immediately when live capacity increases", async () => {
    let capacity = 1;
    const limiter = new SubagentConcurrencyLimiter(() => capacity);
    const first = await limiter.acquire();
    const second = limiter.acquire();
    const third = limiter.acquire();

    capacity = 3;
    limiter.refreshCapacity();

    const [secondLease, thirdLease] = await Promise.all([second, third]);
    expect(secondLease.queuePosition).toBe(1);
    expect(thirdLease.queuePosition).toBe(2);
    expect(limiter.getSnapshot()).toEqual({
      maxConcurrentSubagents: 3,
      queuedSubagents: 0,
      runningSubagents: 3,
    });
    first.release();
    secondLease.release();
    thirdLease.release();
  });

  it("honors a capacity decrease without cancelling active leases", async () => {
    let capacity = 2;
    const limiter = new SubagentConcurrencyLimiter(() => capacity);
    const first = await limiter.acquire();
    const second = await limiter.acquire();
    capacity = 1;
    limiter.refreshCapacity();
    const queued = limiter.acquire();

    first.release();
    await Promise.resolve();
    expect(limiter.getSnapshot()).toEqual({
      maxConcurrentSubagents: 1,
      queuedSubagents: 1,
      runningSubagents: 1,
    });

    second.release();
    const admitted = await queued;
    expect(admitted.runningAtStart).toBe(1);
    admitted.release();
  });

  it("rejects queued and future admissions when disposed", async () => {
    const limiter = new SubagentConcurrencyLimiter(() => 1);
    const active = await limiter.acquire();
    const queued = limiter.acquire();

    limiter.dispose();

    await expect(queued).rejects.toThrow("disposed");
    await expect(limiter.acquire()).rejects.toThrow("disposed");
    expect(limiter.getSnapshot()).toMatchObject({
      queuedSubagents: 0,
      runningSubagents: 1,
    });
    active.release();
    expect(limiter.getSnapshot().runningSubagents).toBe(0);
  });
});
