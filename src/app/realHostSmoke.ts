import type { OpenSessionState } from '@pivi/agent/runtime';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';

import type {
  PiviRealHostSmokeRequest,
  PiviRealHostSmokeResult,
  PiviRealHostSmokeSnapshot,
} from '@/app/hostContracts';

const USER_TEXT_PREFIX = 'Pivi deterministic smoke turn';
const NOTE_CONTENT_PREFIX = '# Pivi deterministic smoke';
const ASSISTANT_TEXT_PREFIX = 'Pivi smoke completed';

interface RealHostSmokeDeps {
  createChatService(turn: {
    notePath: string;
    noteContent: string;
    assistantText: string;
    toolCallId: string;
  }): Promise<PiChatService>;
  createOpenSession(options: { sessionId: string }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string): Promise<OpenSessionState>;
  hydrateOpenSession(session: OpenSessionState): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  removeOpenSession(id: string): Promise<OpenSessionState | null>;
  deleteSessionFile(sessionFile: string): Promise<void>;
  vaultFileExists(path: string): Promise<boolean>;
  readVaultFile(path: string): Promise<string>;
  writeVaultFile(path: string, content: string): Promise<void>;
  removeVaultFile(path: string): Promise<void>;
}

export async function runDevelopmentRealHostSmoke(
  deps: RealHostSmokeDeps,
  request: PiviRealHostSmokeRequest,
): Promise<PiviRealHostSmokeResult> {
  validateRequest(request);
  if (request.operation === 'cleanup') {
    await cleanup(deps, request, true);
    return { version: 1, runId: request.runId, cleaned: true };
  }
  if (request.operation === 'inspect') {
    const session = await deps.openSessionByFile(requireSessionFile(request));
    await deps.hydrateOpenSession(session);
    return snapshot(deps, request, session);
  }

  const userText = `${USER_TEXT_PREFIX}: ${request.runId}`;
  const noteContent = `${NOTE_CONTENT_PREFIX}\n\nrun=${request.runId}\n`;
  const assistantText = `${ASSISTANT_TEXT_PREFIX}: ${request.runId}`;
  if (await deps.vaultFileExists(request.notePath) || await deps.vaultFileExists(request.ledgerPath)) {
    throw new Error('Smoke run-owned path already exists.');
  }
  const session = await deps.createOpenSession({ sessionId: `pivi-smoke-${request.runId}` });
  if (!session.sessionFile) {
    throw new Error('The smoke session did not receive a durable session file.');
  }
  try {
    await deps.writeVaultFile(request.ledgerPath, serializeLedger(request, session));
    const service = await deps.createChatService({
      notePath: request.notePath,
      noteContent,
      assistantText,
      toolCallId: `pivi-smoke-tool-${request.runId}`,
    });
    try {
      service.syncSession({ sessionFile: session.sessionFile });
      const errors: string[] = [];
      for await (const chunk of service.query(service.prepareTurn({ text: userText }))) {
        if (chunk.type === 'error') errors.push(chunk.content);
      }
      if (errors.length > 0) {
        throw new Error(`Smoke turn failed: ${errors.join('; ')}`);
      }
      await deps.updateSession(session.id, service.getSessionStateUpdates());
    } finally {
      service.cleanup();
    }

    const restored = await deps.openSessionByFile(session.sessionFile);
    await deps.hydrateOpenSession(restored);
    return snapshot(deps, request, restored);
  } catch (error) {
    const cleanupRequest = {
      ...request,
      operation: 'cleanup' as const,
      sessionFile: session.sessionFile,
      openSessionId: session.id,
    };
    try {
      await cleanup(deps, cleanupRequest);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Smoke run and cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

async function snapshot(
  deps: RealHostSmokeDeps,
  request: PiviRealHostSmokeRequest,
  session: OpenSessionState,
): Promise<PiviRealHostSmokeSnapshot> {
  if (!session.sessionFile) {
    throw new Error('The restored smoke session has no durable session file.');
  }
  const noteContent = await deps.readVaultFile(request.notePath);
  return {
    version: 1,
    runId: request.runId,
    notePath: request.notePath,
    ledgerPath: request.ledgerPath,
    sessionFile: session.sessionFile,
    openSessionId: session.id,
    noteContent,
    messages: session.messages.map(message => ({
      role: message.role,
      content: message.content,
      toolCalls: (message.toolCalls ?? []).map(toolCall => ({
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
        result: toolCall.result ?? '',
      })),
    })),
  };
}

async function cleanup(
  deps: RealHostSmokeDeps,
  request: PiviRealHostSmokeRequest,
  verifyOwnership = false,
): Promise<void> {
  if (verifyOwnership) {
    const ledger = JSON.parse(await deps.readVaultFile(request.ledgerPath)) as Record<string, unknown>;
    if (
      ledger.version !== 1
      || ledger.runId !== request.runId
      || ledger.notePath !== request.notePath
      || ledger.sessionFile !== request.sessionFile
      || ledger.openSessionId !== request.openSessionId
    ) {
      throw new Error('Refusing to clean resources not owned by this smoke ledger.');
    }
  }

  const failures: unknown[] = [];
  if (request.openSessionId) {
    try {
      await deps.removeOpenSession(request.openSessionId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (request.sessionFile) {
    try {
      if (await deps.vaultFileExists(request.sessionFile)) {
        await deps.deleteSessionFile(request.sessionFile);
      }
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await deps.removeVaultFile(request.notePath);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 0) {
    try {
      await deps.removeVaultFile(request.ledgerPath);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to clean deterministic smoke resources.');
  }
}

function validateRequest(request: PiviRealHostSmokeRequest): void {
  if (request.version !== 1) throw new Error('Unsupported real-host smoke contract version.');
  if (!/^[a-zA-Z0-9-]+$/.test(request.runId)) throw new Error('Invalid real-host smoke run id.');
  if (request.notePath !== `.pivi-smoke/smoke-note-${request.runId}.md`) {
    throw new Error('Invalid real-host smoke note path.');
  }
  if (request.ledgerPath !== `.pivi-smoke/smoke-ledger-${request.runId}.json`) {
    throw new Error('Invalid real-host smoke ledger path.');
  }
  if (request.operation !== 'run' && !request.sessionFile) {
    throw new Error('A session file is required for inspect and cleanup.');
  }
  if (
    request.sessionFile
    && (
      !request.sessionFile.startsWith('.pivi/sessions/')
      || !request.sessionFile.endsWith('.jsonl')
      || request.sessionFile.includes('\\')
      || request.sessionFile.includes('\0')
      || request.sessionFile.split('/').includes('..')
    )
  ) {
    throw new Error('Invalid real-host smoke session path.');
  }
}

function requireSessionFile(request: PiviRealHostSmokeRequest): string {
  if (!request.sessionFile) throw new Error('A session file is required.');
  return request.sessionFile;
}

function serializeLedger(request: PiviRealHostSmokeRequest, session: OpenSessionState): string {
  return JSON.stringify({
    version: 1,
    runId: request.runId,
    notePath: request.notePath,
    sessionFile: session.sessionFile,
    openSessionId: session.id,
  });
}
