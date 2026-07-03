import type { StreamChunk } from '@pivi/pivi-agent-core/foundation';
import { StreamChunkQueue } from '@pivi/pivi-agent-core/runtime/StreamChunkQueue';

function textChunk(content: string): StreamChunk {
  return { type: 'text', content };
}

describe('StreamChunkQueue', () => {
  it('delivers pushed chunks in FIFO order when consumers call next after push', async () => {
    const queue = new StreamChunkQueue();
    queue.push(textChunk('first'));
    queue.push(textChunk('second'));

    await expect(queue.next()).resolves.toEqual(textChunk('first'));
    await expect(queue.next()).resolves.toEqual(textChunk('second'));
  });

  it('resolves a pending next() when push arrives before the consumer awaited', async () => {
    const queue = new StreamChunkQueue();
    const pending = queue.next();

    queue.push(textChunk('delivered'));

    await expect(pending).resolves.toEqual(textChunk('delivered'));
  });

  it('resolves every pending waiter with null when closed', async () => {
    const queue = new StreamChunkQueue();
    const first = queue.next();
    const second = queue.next();

    queue.close();

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });

  it('is idempotent on close: repeated close does not re-resolve waiters', async () => {
    const queue = new StreamChunkQueue();
    const waiter = queue.next();

    queue.close();
    queue.close();

    await expect(waiter).resolves.toBeNull();
    await expect(queue.next()).resolves.toBeNull();
  });

  it('drains buffered chunks before returning null after close', async () => {
    const queue = new StreamChunkQueue();
    queue.push(textChunk('queued'));
    queue.close();

    await expect(queue.next()).resolves.toEqual(textChunk('queued'));
    await expect(queue.next()).resolves.toBeNull();
  });

  it('returns null immediately on next when already closed and the buffer is empty', async () => {
    const queue = new StreamChunkQueue();
    queue.close();

    await expect(queue.next()).resolves.toBeNull();
  });

  it('prefers direct handoff to the oldest waiter over enqueueing when next is already pending', async () => {
    const queue = new StreamChunkQueue();
    const firstWaiter = queue.next();
    const secondWaiter = queue.next();

    queue.push(textChunk('one'));
    queue.push(textChunk('two'));

    await expect(firstWaiter).resolves.toEqual(textChunk('one'));
    await expect(secondWaiter).resolves.toEqual(textChunk('two'));
    queue.close();
    await expect(queue.next()).resolves.toBeNull();
  });
});