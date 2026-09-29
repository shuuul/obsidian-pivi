const mockPurgeDeletedSessionFiles = jest.fn();
const mockDeleteSession = jest.fn();

jest.mock("@/app/pluginSessionApi", () => {
  const actual = jest.requireActual<typeof import("@/app/pluginSessionApi")>(
    "@/app/pluginSessionApi",
  );
  return {
    ...actual,
    deleteSession: mockDeleteSession,
    purgeDeletedSessionFiles: mockPurgeDeletedSessionFiles,
  };
});

import type { OpenSessionState } from "@pivi/agent/runtime";
import type { SessionStore } from "@pivi/agent/session";
import { OpenSessionManager } from "@pivi/agent/session/openSessionManager";
import type { SharedAppStorage } from "@pivi/obsidian-host/bootstrap/storage";
import type { App } from "obsidian";

import { ApplicationSessions } from "@/app/applicationSessions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSessions(openSessions: OpenSessionState[] = []) {
  const store = {} as SessionStore;
  const sessionManager = new OpenSessionManager({
    getVaultPath: () => null,
    getStore: () => store,
  });
  sessionManager.replaceAll(openSessions);
  return new ApplicationSessions({
    app: {} as App,
    sessionManager,
    requireSessionStore: () => store,
    getStorage: () => ({}) as SharedAppStorage,
    getSettings: () => ({ chatViewPlacement: 'right-sidebar', deletedSessionRetentionDays: 30 }),
    getAllViews: () => [],
  });
}

describe("ApplicationSessions", () => {
  beforeEach(() => {
    mockPurgeDeletedSessionFiles.mockReset();
    mockDeleteSession.mockReset();
  });

  it("serializes file-moving operations even after an earlier one fails", async () => {
    const sessions = createSessions();
    const firstDelete = deferred<void>();
    mockDeleteSession.mockReturnValueOnce(firstDelete.promise);
    mockPurgeDeletedSessionFiles.mockResolvedValueOnce(3);

    const deletion = sessions.deleteSession("a");
    const purge = sessions.purgeDeletedSessionFiles();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockDeleteSession).toHaveBeenCalledTimes(1);
    expect(mockPurgeDeletedSessionFiles).not.toHaveBeenCalled();

    firstDelete.reject(new Error("trash failed"));
    await expect(deletion).rejects.toThrow("trash failed");
    await expect(purge).resolves.toBe(3);
    expect(mockPurgeDeletedSessionFiles).toHaveBeenCalledTimes(1);
  });

  it("rejects transcript recovery for a session that is not open", async () => {
    const sessions = createSessions();

    await expect(sessions.sessionRecovery.read(".pivi/sessions/missing.jsonl"))
      .rejects.toThrow("Session not found: .pivi/sessions/missing.jsonl");
  });
});
