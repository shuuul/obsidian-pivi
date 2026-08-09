import type { OpenSessionState } from '../foundation';

export const LEGACY_PI_SESSION_FILE_STATE_KEY = 'piSessionFile';

export function getLegacySessionFileFromAgentState(
  agentState?: Record<string, unknown>,
): string | undefined {
  const value = agentState?.[LEGACY_PI_SESSION_FILE_STATE_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function removeLegacySessionFileFromAgentState(
  agentState?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!agentState || !(LEGACY_PI_SESSION_FILE_STATE_KEY in agentState)) {
    return agentState;
  }
  const rest = { ...agentState };
  delete rest[LEGACY_PI_SESSION_FILE_STATE_KEY];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function buildSessionStateUpdates(input: {
  sessionId: string | null;
  sessionFile?: string | null;
  agentState?: Record<string, unknown>;
}): Partial<OpenSessionState> {
  return {
    sessionId: input.sessionId,
    sessionFile: input.sessionFile ?? undefined,
    agentState: removeLegacySessionFileFromAgentState(input.agentState),
  };
}
