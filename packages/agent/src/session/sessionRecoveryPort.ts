/** Host-provided access to durable and recoverable Pivi sessions. */
export interface SessionRecoveryPort {
  read(sessionFile: string): Promise<string>;
  listDeleted(): Promise<Array<{
    sessionFile: string;
    deletedAt: number;
    expiresAt: number;
    retentionDays: number;
  }>>;
  restore(sessionFile: string): Promise<{
    sessionId: string;
    title: string;
    sessionFile: string;
  }>;
}
