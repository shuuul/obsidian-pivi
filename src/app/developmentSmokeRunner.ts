import type { SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";

import type { PiviChatCompositionHost } from "@/app/hostContracts";
import type { PiviApplication } from "@/app/PiviApplication";

/** Application internals reachable only by the development real-host smoke harness. */
export interface DevelopmentSmokeInternals {
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
}

/** Returns undefined in production builds so the harness is not reachable there. */
export function createDevelopmentSmokeRunner(
  application: PiviApplication,
  internals: DevelopmentSmokeInternals,
): PiviChatCompositionHost['runDevelopmentRealHostSmoke'] {
  if (process.env.NODE_ENV === 'production') return undefined;
  const { sessionOperations: sessions } = application;
  return async (request) => {
    const { runDevelopmentRealHostSmoke } = await import('@/app/realHostSmoke');
    return runDevelopmentRealHostSmoke({
      createChatService: async turn => {
        const development = (await application.ensureWorkspaceServices()).development;
        if (!development) {
          throw new Error('The deterministic smoke provider is unavailable.');
        }
        return development.createDeterministicSmokeChatService(
          application,
          application.httpClient,
          turn,
        );
      },
      createOpenSession: options => sessions.createSession(options),
      openSessionByFile: sessionFile => sessions.openSessionFile(sessionFile),
      hydrateOpenSession: session => internals.sessionManager.hydrate(session),
      updateSession: (id, updates) => sessions.updateSession(id, updates),
      removeOpenSession: id => internals.sessionManager.delete(id),
      deleteSessionFile: sessionFile => internals.requireSessionStore().deleteSession(sessionFile),
      vaultFileExists: path => application.app.vault.adapter.exists(path),
      readVaultFile: path => application.app.vault.adapter.read(path),
      writeVaultFile: async (path, content) => {
        await application.app.vault.create(path, content);
      },
      removeVaultFile: async path => {
        if (await application.app.vault.adapter.exists(path)) {
          await application.app.vault.adapter.remove(path);
        }
      },
    }, request);
  };
}
