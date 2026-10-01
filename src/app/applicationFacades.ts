import type { SessionStore } from "@pivi/agent/session";
import type { OpenSessionManager } from "@pivi/agent/session/openSessionManager";

import type {
  ChatFacade,
  IntegrationsFacade,
  PiviApplicationFacades,
  SettingsFacade,
  WorkspaceFacade,
} from "@/app/hostContracts";
import type { PiviApplication } from "@/app/PiviApplication";

/** Application internals reachable only by the development real-host smoke harness. */
export interface ApplicationFacadeInternals {
  sessionManager: OpenSessionManager;
  requireSessionStore(): SessionStore;
}

function createDevelopmentSmokeRunner(
  application: PiviApplication,
  internals: ApplicationFacadeInternals,
): Pick<ChatFacade, 'runDevelopmentRealHostSmoke'> {
  if (process.env.NODE_ENV === 'production') return {};
  const { sessionOperations: sessions } = application;
  return {
    runDevelopmentRealHostSmoke: async (request) => {
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
        createOpenSession: options => sessions.createOpenSession(options),
        openSessionByFile: sessionFile => sessions.openSessionByFile(sessionFile),
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
    },
  };
}

/**
 * Builds the responsibility-scoped facades handed to registrations. Each is a
 * delegating object over the application, so settings stay live through getters.
 */
export function createApplicationFacades(
  application: PiviApplication,
  internals: ApplicationFacadeInternals,
): PiviApplicationFacades {
  const { app } = application;
  const sessions = application.sessionOperations;
  const chat: ChatFacade = {
    app,
    get settings() { return application.settings; },
    saveSettings: () => application.saveSettings(),
    getAgentHostContext: () => application.getAgentHostContext(),
    getVaultPath: () => application.getVaultPath(),
    getUiFacades: () => application.getUiFacades(),
    getAllViews: () => application.getAllViews(),
    loadTabManagerState: () => application.loadTabManagerState(),
    persistTabManagerState: state => application.persistTabManagerState(state),
    getChatPerfController: () => application.getChatPerfController(),
    getChatPerfRecorder: () => application.getChatPerfRecorder(),
    createChatService: options => application.createChatService(options),
    createAuxQueryRunner: () => application.createAuxQueryRunner(),
    activateView: () => application.activateView(),
    canCreateNewTab: () => application.canCreateNewTab(),
    openNewTab: () => application.openNewTab(),
    addEditorSelectionToChatInput: (editor, view) => application.addEditorSelectionToChatInput(editor, view),
    ...createDevelopmentSmokeRunner(application, internals),
  };
  const workspace: WorkspaceFacade = {
    app,
    ensureWorkspaceServices: () => application.ensureWorkspaceServices(),
    getAllViews: () => application.getAllViews(),
    refreshPiviManagement: domain => application.refreshPiviManagement(domain),
  };
  const integrations: IntegrationsFacade = {
    app,
    get settings() { return application.settings; },
    manifest: application.manifest,
    getUiFacades: () => application.getUiFacades(),
    ensureWorkspaceServices: () => application.ensureWorkspaceServices(),
    addEditorSelectionToChatInput: (editor, view) => application.addEditorSelectionToChatInput(editor, view),
  };
  const settings: SettingsFacade = {
    app,
    get settings() { return application.settings; },
    saveSettings: () => application.saveSettings(),
    getAgentHostContext: () => application.getAgentHostContext(),
    getVaultPath: () => application.getVaultPath(),
    getUiFacades: () => application.getUiFacades(),
    get storage() { return application.storage; },
    httpClient: application.httpClient,
    processRunner: application.processRunner,
    getAllViews: () => application.getAllViews(),
    refreshVaultSkills: () => application.refreshVaultSkills(),
    openStyleSettings: () => application.openStyleSettings(),
    isNoteToolbarInstalled: () => application.noteToolbar.isInstalled(),
    setupNoteToolbarIntegration: style => application.noteToolbar.setupSelectionCommand(style),
    purgeDeletedSessionFiles: () => sessions.purgeDeletedSessionFiles(),
    purgeExpiredDeletedSessionFiles: () => sessions.purgeExpiredDeletedSessionFiles(),
    loadSessionMaintenance: () => sessions.loadSessionMaintenance(),
    deleteAllArchivedChats: () => sessions.deleteAllArchivedChats(),
    getActiveEnvironmentVariables: () => application.getActiveEnvironmentVariables(),
    getEnvironmentVariablesForScope: scope => application.getEnvironmentVariablesForScope(scope),
    applyEnvironmentVariables: (scope, text) => application.applyEnvironmentVariables(scope, text),
    applyEnvironmentVariablesBatch: updates => application.applyEnvironmentVariablesBatch(updates),
    importEnvironmentText: (scope, text) => application.importEnvironmentText(scope, text),
    listEnvironmentEntries: scope => application.listEnvironmentEntries(scope),
    getEnvironmentStore: () => application.getEnvironmentStore(),
    notify: (message, timeout) => application.notify(message, timeout),
  };
  return { chat, sessions, workspace, integrations, settings };
}
