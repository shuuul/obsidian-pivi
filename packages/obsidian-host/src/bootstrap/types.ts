/** Tab manager state persisted across restarts. */
export interface AppTabManagerState {
  openTabs: Array<{
    tabId: string;
    sessionFile?: string | null;
    leafId?: string | null;
    draftModel?: string | null;
    /** Custom title set on a blank tab before a session is created. */
    draftTitle?: string | null;
    isArchived?: boolean;
    needsAttention?: boolean;
  }>;
  activeTabId: string | null;
}
