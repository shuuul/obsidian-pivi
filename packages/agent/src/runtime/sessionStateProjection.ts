import type { OpenSessionState } from './chatTypes';

export function buildSessionStateUpdates(input: {
  sessionId: string | null;
  sessionFile?: string | null;
  agentState?: Record<string, unknown>;
}): Partial<OpenSessionState> {
  return {
    sessionId: input.sessionId,
    sessionFile: input.sessionFile ?? undefined,
    agentState: input.agentState,
  };
}
