import type { OpenSessionState } from '@pivi/pivi-agent-core/foundation';
import {
  buildSessionStateUpdates,
  getLegacySessionFileFromAgentState,
  LEGACY_PI_SESSION_FILE_STATE_KEY,
  removeLegacySessionFileFromAgentState,
} from '@pivi/pivi-agent-core/runtime/sessionStateProjection';

describe('getLegacySessionFileFromAgentState', () => {
  it.each([
    { name: 'non-empty legacy path', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: 'sessions/foo.jsonl' }, expected: 'sessions/foo.jsonl' },
    { name: 'missing agentState', agentState: undefined, expected: undefined },
    { name: 'missing legacy key', agentState: { other: 'value' }, expected: undefined },
    { name: 'empty string legacy path', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: '' }, expected: undefined },
    { name: 'whitespace-only legacy path', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: '   ' }, expected: '   ' },
    { name: 'non-string number', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: 42 }, expected: undefined },
    { name: 'non-string null', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: null }, expected: undefined },
    { name: 'non-string object', agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: { path: 'x' } }, expected: undefined },
  ])('returns $expected when $name', ({ agentState, expected }) => {
    expect(getLegacySessionFileFromAgentState(agentState)).toBe(expected);
  });
});

describe('removeLegacySessionFileFromAgentState', () => {
  it('returns undefined agentState unchanged', () => {
    expect(removeLegacySessionFileFromAgentState(undefined)).toBeUndefined();
  });

  it('returns agentState unchanged when legacy key is absent', () => {
    const agentState = { model: 'provider/foo', leaf: 'leaf-1' };
    expect(removeLegacySessionFileFromAgentState(agentState)).toBe(agentState);
  });

  it('strips legacy piSessionFile and preserves other keys', () => {
    const agentState = {
      [LEGACY_PI_SESSION_FILE_STATE_KEY]: 'sessions/legacy.jsonl',
      model: 'provider/foo',
      thinkingBudget: 'high',
    };

    expect(removeLegacySessionFileFromAgentState(agentState)).toEqual({
      model: 'provider/foo',
      thinkingBudget: 'high',
    });
    expect(agentState).toHaveProperty(LEGACY_PI_SESSION_FILE_STATE_KEY, 'sessions/legacy.jsonl');
  });

  it('returns undefined when legacy piSessionFile was the only key', () => {
    expect(
      removeLegacySessionFileFromAgentState({
        [LEGACY_PI_SESSION_FILE_STATE_KEY]: 'sessions/only.jsonl',
      }),
    ).toBeUndefined();
  });
});

describe('buildSessionStateUpdates', () => {
  it('projects sessionId, optional sessionFile, and sanitized agentState', () => {
    const updates = buildSessionStateUpdates({
      sessionId: 'sess-42',
      sessionFile: 'sessions/active.jsonl',
      agentState: {
        [LEGACY_PI_SESSION_FILE_STATE_KEY]: 'sessions/stale.jsonl',
        effortLevel: 'medium',
      },
    });

    expect(updates).toEqual<Partial<OpenSessionState>>({
      sessionId: 'sess-42',
      sessionFile: 'sessions/active.jsonl',
      agentState: { effortLevel: 'medium' },
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

  it('passes through null sessionId and drops legacy-only agentState', () => {
    const updates = buildSessionStateUpdates({
      sessionId: null,
      sessionFile: undefined,
      agentState: { [LEGACY_PI_SESSION_FILE_STATE_KEY]: 'sessions/legacy.jsonl' },
    });

    expect(updates).toEqual({
      sessionId: null,
      sessionFile: undefined,
      agentState: undefined,
    });
  });
});