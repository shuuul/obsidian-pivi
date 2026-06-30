export const PIVI_SESSION_META = 'pivi/session-meta';
export const PIVI_UI_CONTEXT = 'pivi/ui-context';
export const PIVI_MESSAGE_UI = 'pivi/message-ui';

export interface PiviSessionMetaData {
  title: string;
  titleGenerationStatus?: 'pending' | 'success' | 'failed';
  createdAt: number;
  lastResponseAt?: number;
}

export interface PiviUiContextData {
  currentNote?: string;
  externalContextPaths?: string[];
  enabledMcpServers?: string[];
}

export interface PiviMessageUiData {
  targetEntryId: string;
  displayContent?: string;
  contentBlocks?: unknown[];
  durationSeconds?: number;
  durationFlavorWord?: string;
  userMessageId?: string;
  assistantMessageId?: string;
}
