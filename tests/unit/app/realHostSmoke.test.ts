import type { OpenSessionState, StreamChunk } from '@pivi/agent/runtime';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';

import { runDevelopmentRealHostSmoke } from '@/app/realHostSmoke';

const request = {
  version: 1 as const,
  operation: 'run' as const,
  runId: 'run-123',
  notePath: '.pivi-smoke/smoke-note-run-123.md',
  ledgerPath: '.pivi-smoke/smoke-ledger-run-123.json',
};
const sessionFile = '.pivi/sessions/device/smoke.jsonl';
const openSessionId = 'open-run-123';

function createSession(messages: OpenSessionState['messages'] = []): OpenSessionState {
  return {
    id: openSessionId,
    title: 'Smoke',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'pivi-smoke-run-123',
    sessionFile,
    messages,
  };
}

function createService(chunks: StreamChunk[] = [{ type: 'done' }]): PiChatService {
  return {
    prepareTurn: jest.fn(input => ({
      request: input,
      displayContent: input.text,
      persistedContent: input.text,
      prompt: input.text,
      isCompact: false,
      mcpMentions: new Set(),
    })),
    syncSession: jest.fn(),
    query: jest.fn(async function* () {
      yield* chunks;
    }),
    getSessionStateUpdates: jest.fn(() => ({ sessionFile })),
    cleanup: jest.fn(),
  } as unknown as PiChatService;
}

function createDeps(options: { chunks?: StreamChunk[]; cleanupNoteFailure?: boolean } = {}) {
  const service = createService(options.chunks);
  const restored = createSession([
    {
      id: 'user-1',
      role: 'user',
      content: 'Pivi deterministic smoke turn: run-123',
      timestamp: 1,
    },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Pivi smoke completed: run-123',
      timestamp: 2,
      toolCalls: [{
        id: 'pivi-smoke-tool-run-123',
        name: 'write',
        input: { path: request.notePath },
        status: 'completed',
        result: 'Wrote .pivi-smoke/smoke-note-run-123.md',
      }],
    },
  ]);
  return {
    service,
    deps: {
      createChatService: jest.fn(async () => service),
      createOpenSession: jest.fn(async () => createSession()),
      openSessionByFile: jest.fn(async () => restored),
      hydrateOpenSession: jest.fn(async (session: OpenSessionState) => {
        session.messages = restored.messages;
      }),
      updateSession: jest.fn(async () => undefined),
      removeOpenSession: jest.fn(async () => restored),
      deleteSessionFile: jest.fn(async () => undefined),
      vaultFileExists: jest.fn(async (path: string) => path === sessionFile),
      readVaultFile: jest.fn(async (path: string) => path === request.ledgerPath
        ? JSON.stringify({
          version: 1,
          runId: request.runId,
          notePath: request.notePath,
          sessionFile,
          openSessionId,
        })
        : '# Pivi deterministic smoke\n\nrun=run-123\n'),
      writeVaultFile: jest.fn(async () => undefined),
      removeVaultFile: jest.fn(async () => {
        if (options.cleanupNoteFailure) throw new Error('note cleanup failed');
      }),
    },
  };
}

describe('development real-host smoke harness', () => {
  it('runs a normal service turn and returns semantic restored state', async () => {
    const { deps, service } = createDeps();

    const result = await runDevelopmentRealHostSmoke(deps, request);

    expect(result).toMatchObject({
      version: 1,
      runId: 'run-123',
      sessionFile,
      noteContent: '# Pivi deterministic smoke\n\nrun=run-123\n',
      messages: [
        { role: 'user', content: 'Pivi deterministic smoke turn: run-123' },
        { role: 'assistant', content: 'Pivi smoke completed: run-123' },
      ],
    });
    expect(service.syncSession).toHaveBeenCalledWith({ sessionFile });
    expect(deps.updateSession).toHaveBeenCalledWith(openSessionId, { sessionFile });
    expect(service.cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans the created session and note when the turn fails', async () => {
    const { deps, service } = createDeps({
      chunks: [{ type: 'error', content: 'tool failed' }, { type: 'done' }],
    });

    await expect(runDevelopmentRealHostSmoke(deps, request)).rejects.toThrow('Smoke turn failed: tool failed');

    expect(service.cleanup).toHaveBeenCalledTimes(1);
    expect(deps.removeOpenSession).toHaveBeenCalledWith(openSessionId);
    expect(deps.deleteSessionFile).toHaveBeenCalledWith(sessionFile);
    expect(deps.removeVaultFile).toHaveBeenCalledWith(request.notePath);
  });

  it('attempts sibling cleanup and reports a cleanup failure', async () => {
    const { deps } = createDeps({ cleanupNoteFailure: true });

    await expect(runDevelopmentRealHostSmoke(deps, {
      ...request,
      operation: 'cleanup',
      sessionFile,
      openSessionId,
    })).rejects.toThrow('Failed to clean deterministic smoke resources');

    expect(deps.removeOpenSession).toHaveBeenCalledTimes(1);
    expect(deps.deleteSessionFile).toHaveBeenCalledTimes(1);
    expect(deps.removeVaultFile).toHaveBeenCalledTimes(1);
  });

  it('refuses cleanup when the ownership ledger does not match', async () => {
    const { deps } = createDeps();
    deps.readVaultFile.mockResolvedValue(JSON.stringify({
      version: 1,
      runId: request.runId,
      notePath: request.notePath,
      sessionFile: '.pivi/sessions/device/other.jsonl',
      openSessionId,
    }));

    await expect(runDevelopmentRealHostSmoke(deps, {
      ...request,
      operation: 'cleanup',
      sessionFile,
      openSessionId,
    })).rejects.toThrow('Refusing to clean resources not owned by this smoke ledger');

    expect(deps.removeOpenSession).not.toHaveBeenCalled();
    expect(deps.deleteSessionFile).not.toHaveBeenCalled();
    expect(deps.removeVaultFile).not.toHaveBeenCalled();
  });

  it('rejects stale contract versions before touching resources', async () => {
    const { deps } = createDeps();

    await expect(runDevelopmentRealHostSmoke(
      deps,
      { ...request, version: 2 } as unknown as typeof request,
    )).rejects.toThrow('Unsupported real-host smoke contract version');

    expect(deps.createOpenSession).not.toHaveBeenCalled();
  });
});
