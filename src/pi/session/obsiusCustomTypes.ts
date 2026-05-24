export const OBSIUS_SESSION_META = 'obsius/session-meta';
export const OBSIUS_UI_CONTEXT = 'obsius/ui-context';
export const OBSIUS_MESSAGE_UI = 'obsius/message-ui';

export interface ObsiusSessionMetaData {
  title: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  createdAt: number;
  lastResponseAt?: number;
}

export interface ObsiusUiContextData {
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface ObsiusMessageUiData {
  targetEntryId: string;
  displayContent?: string;
  contentBlocks?: unknown[];
  durationSeconds?: number;
  durationFlavorWord?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}
