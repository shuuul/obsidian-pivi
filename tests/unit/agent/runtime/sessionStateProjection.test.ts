import type { OpenSessionState } from '@pivi/agent/runtime';
import {
  buildSessionStateUpdates,
} from '@pivi/agent/runtime/sessionStateProjection';

describe('buildSessionStateUpdates', () => {
  it('projects sessionId, optional sessionFile, and agentState', () => {
    const updates = buildSessionStateUpdates({
      sessionId: 'sess-42',
      sessionFile: 'sessions/active.jsonl',
      agentState: { model: 'provider/foo' },
    });

    expect(updates).toEqual<Partial<OpenSessionState>>({
      sessionId: 'sess-42',
      sessionFile: 'sessions/active.jsonl',
      agentState: { model: 'provider/foo' },
    });
  });

  it.each([
    { name: 'null sessionFile', sessionFile: null, expectedFile: undefined },
    { name: 'undefined sessionFile', sessionFile: undefined, expectedFile: undefined },
    { name: 'empty sessionFile string', sessionFile: '', expectedFile: '' },
  ])('omits nullable sessionFile as undefined when $name', ({ sessionFile, expectedFile }) => {
    const updates = buildSessionStateUpdates({
      sessionId: 'sess-1',
      sessionFile,
      agentState: { model: 'provider/bar' },
    });

    expect(updates.sessionId).toBe('sess-1');
    expect(updates.sessionFile).toBe(expectedFile);
    expect(updates.agentState).toEqual({ model: 'provider/bar' });
  });
});