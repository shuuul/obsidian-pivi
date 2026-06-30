import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  type SessionEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import { sanitizeAgentMessagesForLlm } from './agentMessageHistory';
import { getPiviSessionDir } from './piviSessionPaths';
import { toAbsoluteSessionPath } from './sessionPathUtils';

const SESSION_FILE_KEY = 'piSessionFile';

export function getSessionFileFromAgentState(
  agentState?: Record<string, unknown>,
): string | undefined {
  const value = agentState?.[SESSION_FILE_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function withoutSessionFileInAgentState(
  agentState?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!agentState || !(SESSION_FILE_KEY in agentState)) {
    return agentState;
  }
  const { [SESSION_FILE_KEY]: _legacySessionFile, ...rest } = agentState;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Pi-compatible JSONL session under `.pivi/sessions/`. */
export class PiSessionBridge {
  private manager: SessionManager | null = null;

  constructor(
    private readonly vaultPath: string,
    sessionFile?: string,
  ) {
    if (sessionFile) {
      if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
        this.manager = SessionManager.inMemory(vaultPath);
      } else {
        const absolute = toAbsoluteSessionPath(vaultPath, sessionFile);
        this.manager = SessionManager.open(absolute, getPiviSessionDir(vaultPath), vaultPath);
      }
    }
  }

  static createNew(vaultPath: string): PiSessionBridge {
    if (vaultPath.startsWith('/test/') || process.env.NODE_ENV === 'test') {
      return PiSessionBridge.inMemory(vaultPath);
    }
    const sessionDir = getPiviSessionDir(vaultPath);
    const manager = SessionManager.create(vaultPath, sessionDir);
    return new PiSessionBridge(vaultPath, manager.getSessionFile());
  }

  static inMemory(vaultPath: string): PiSessionBridge {
    const bridge = new PiSessionBridge(vaultPath);
    bridge.manager = SessionManager.inMemory(vaultPath);
    return bridge;
  }

  getSessionFile(): string | null {
    return this.manager?.getSessionFile() ?? null;
  }

  getSessionId(): string | null {
    return this.manager?.getSessionId() ?? null;
  }

  /** Restore agent messages from JSONL leaf branch. */
  loadAgentMessages(): AgentMessage[] {
    if (!this.manager) {
      return [];
    }
    const context = this.manager.buildSessionContext();
    return sanitizeAgentMessagesForLlm(context.messages);
  }

  appendUserMessage(content: string): void {
    this.manager?.appendMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  /** Extract current branch into a new session file (pi-compatible). */
  forkToNewFile(): PiSessionBridge | null {
    if (!this.manager) {
      return null;
    }
    const leafId = this.manager.getLeafId();
    if (!leafId) {
      return null;
    }
    const file = this.manager.createBranchedSession(leafId);
    if (!file) {
      return null;
    }
    return new PiSessionBridge(this.vaultPath, file);
  }

  getEntries(): SessionEntry[] {
    return this.manager?.getEntries() ?? [];
  }
}
