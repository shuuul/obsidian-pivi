/** @jest-environment jsdom */

import type { App, DataAdapter } from 'obsidian';

import {
  createChatPerfController,
  type ChatPerfTrace,
} from '@/app/chatPerformanceRecorder';

function createAdapter(): jest.Mocked<DataAdapter> {
  return {
    exists: jest.fn(async () => false),
    mkdir: jest.fn(async () => undefined),
    write: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<DataAdapter>;
}

describe('chat performance recorder', () => {
  it('aggregates projection latency and exports a versioned vault-local trace', async () => {
    const adapter = createAdapter();
    const app = { vault: { adapter } } as unknown as App;
    const recorder = createChatPerfController(app, '0.9.0', '1.13.2', window);

    recorder.start('5K cold open', window);
    recorder.onProjectionEvent('message.upsert', 'assistant-1', window);
    recorder.onProjectionEvent('message.upsert', 'assistant-1', window);
    recorder.onProjectionCommit('animation-frame', ['assistant-1'], 1.25, window);
    recorder.onProjectionPaint('animation-frame', ['assistant-1'], window);
    recorder.onVirtualRows(12, 80, window);
    recorder.onScrollAnchor('message-100', 0.5, window);
    recorder.onMarkdownRender('block-1', 'terminal', 256, 4.5, window);

    const path = await recorder.stopAndExport(window);

    expect(path).toMatch(/^\.pivi\/perf-traces\/.+-5k-cold-open\.json$/);
    expect(adapter.mkdir).toHaveBeenCalledWith('.pivi');
    expect(adapter.mkdir).toHaveBeenCalledWith('.pivi/perf-traces');
    expect(adapter.write).toHaveBeenCalledWith(path, expect.any(String));
    const trace = JSON.parse(adapter.write.mock.calls[0]?.[1] ?? '') as ChatPerfTrace;
    expect(trace).toMatchObject({
      schema: 'pivi-chat-perf-v1',
      scenario: '5K cold open',
      environment: {
        obsidianVersion: '1.13.2',
        piviVersion: '0.9.0',
        windowTypes: ['main'],
      },
    });
    expect(trace.events.filter(event => event.type === 'heap.sample')).toHaveLength(2);
    expect(trace.events).toContainEqual(expect.objectContaining({
      type: 'projection.commit',
      queuedEventCount: 2,
      commitDurationMs: 1.25,
    }));
    expect(trace.events).toContainEqual(expect.objectContaining({
      type: 'projection.paint',
      commitToPaintMs: expect.any(Number),
      eventToPaintMs: expect.any(Number),
    }));
    expect(recorder.enabled).toBe(false);
  });

  it('fails explicitly for invalid trace lifecycle transitions', async () => {
    const adapter = createAdapter();
    const recorder = createChatPerfController(
      { vault: { adapter } } as unknown as App,
      '0.9.0',
      '1.13.2',
      window,
    );

    expect(() => recorder.start('   ', window)).toThrow('scenario is required');
    await expect(recorder.stopAndExport(window)).rejects.toThrow('No chat performance trace');
    recorder.start('manual', window);
    expect(() => recorder.start('second', window)).toThrow('already active');
    recorder.dispose();
    expect(recorder.enabled).toBe(false);
  });
});
