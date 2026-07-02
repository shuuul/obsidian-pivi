/** Tab manager state persisted across restarts. */
export interface AppTabManagerState {
  openTabs: Array<{
    tabId: string;
    sessionFile?: string | null;
    leafId?: string | null;
    draftModel?: string | null;
    isArchived?: boolean;
    needsAttention?: boolean;
  }>;
  activeTabId: string | null;
}
