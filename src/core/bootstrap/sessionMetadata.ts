import type { SessionMetadata } from '../types';

type AgentStateCarrier = {
  agentState?: Record<string, unknown>;
  providerState?: Record<string, unknown>;
};

/** Resolves persisted agent state, accepting the legacy `providerState` key. */
export function resolveAgentState(
  source: AgentStateCarrier,
): Record<string, unknown> | undefined {
  const state = source.agentState ?? source.providerState;
  if (!state || Object.keys(state).length === 0) {
    return undefined;
  }
  return state;
}

/** Normalizes session metadata loaded from disk (migrates `providerState` → `agentState`). */
export function normalizeSessionMetadata(
  raw: SessionMetadata & AgentStateCarrier,
): SessionMetadata {
  const agentState = resolveAgentState(raw);
  const { providerState: _legacy, ...rest } = raw;
  return {
    ...rest,
    agentState,
  };
}
