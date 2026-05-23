import {
  normalizeSessionMetadata,
  resolveAgentState,
} from '../../../src/core/bootstrap/sessionMetadata';
import type { SessionMetadata } from '../../../src/core/types';

describe('sessionMetadata', () => {
  const base: SessionMetadata = {
    id: 'conv-1',
    title: 'Test',
    createdAt: 1,
    updatedAt: 2,
  };

  it('resolveAgentState prefers agentState over legacy providerState', () => {
    expect(resolveAgentState({
      agentState: { fork: true },
      providerState: { legacy: true },
    })).toEqual({ fork: true });
  });

  it('resolveAgentState falls back to providerState', () => {
    expect(resolveAgentState({
      providerState: { legacy: true },
    })).toEqual({ legacy: true });
  });

  it('resolveAgentState returns undefined for empty bags', () => {
    expect(resolveAgentState({ agentState: {} })).toBeUndefined();
    expect(resolveAgentState({})).toBeUndefined();
  });

  it('normalizeSessionMetadata migrates providerState to agentState', () => {
    const normalized = normalizeSessionMetadata({
      ...base,
      providerState: { resumeAt: 'msg-1' },
    });

    expect(normalized.agentState).toEqual({ resumeAt: 'msg-1' });
    expect(normalized).not.toHaveProperty('providerState');
  });

  it('normalizeSessionMetadata keeps agentState when already present', () => {
    const normalized = normalizeSessionMetadata({
      ...base,
      agentState: { fork: true },
    });

    expect(normalized.agentState).toEqual({ fork: true });
    expect(normalized).not.toHaveProperty('providerState');
  });
});
