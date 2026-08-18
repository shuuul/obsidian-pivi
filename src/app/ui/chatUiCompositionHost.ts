import type { OpenSessionState, SessionSummary } from '@pivi/agent/foundation';
import type { CapabilityApprovalPort } from '@pivi/agent/ports';
import type { AuxQueryRunner } from '@pivi/agent/runtime/auxQueryRunner';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';
import type { SessionMessagePage } from '@pivi/agent/session';
import type { PiviManagementApprovalPort } from '@pivi/agent/tools/piviManagement';
import type { ChatPerfRecorder } from '@pivi/pivi-react/store';

import type { PiviChatCompositionHost } from '@/app/hostContracts';

/** Composition-only plugin capabilities adapted into core-owned chat ports. */
export type ChatUiCompositionHost = PiviChatCompositionHost & {
  getChatPerfRecorder(): ChatPerfRecorder;
  createChatService(options?: {
    capabilityApproval?: CapabilityApprovalPort | null;
    piviManagementApproval?: PiviManagementApprovalPort | null;
  }): PiChatService;
  createAuxQueryRunner(): AuxQueryRunner;
  getSessionList(): SessionSummary[];
  getOpenSessionSync(id: string): OpenSessionState | null;
  getOpenSessionById(id: string): Promise<OpenSessionState | null>;
  openRecentSessionMessages(id: string, limit: number): Promise<SessionMessagePage | null>;
  readOlderSessionMessages(
    id: string,
    beforeEntryId: string,
    limit: number,
  ): Promise<SessionMessagePage | null>;
  createOpenSession(options?: {
    sessionId?: string;
    sessionFile?: string;
  }): Promise<OpenSessionState>;
  openSessionByFile(sessionFile: string): Promise<OpenSessionState>;
  deleteSession(id: string): Promise<void>;
  deleteSessionFile(sessionFile: string, id?: string | null): Promise<void>;
  renameSession(
    id: string,
    title: string,
    titleSource?: OpenSessionState['titleSource'],
  ): Promise<void>;
  updateSession(id: string, updates: Partial<OpenSessionState>): Promise<void>;
  forkSessionAt(
    openSession: OpenSessionState,
    atEntryId: string,
  ): Promise<{ sessionFile: string; sessionId: string } | null>;
};
