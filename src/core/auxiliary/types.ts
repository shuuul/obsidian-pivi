import type { CursorContext } from '../../utils/editor';

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  openSessionId: string,
  result: TitleGenerationResult,
) => Promise<void>;

export interface TitleGenerationService {
  generateTitle(
    openSessionId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void>;
  cancel(): void;
}

export type InlineEditMode = 'selection' | 'cursor';

export interface InlineEditSelectionRequest {
  mode: 'selection';
  instruction: string;
  notePath: string;
  selectedText: string;
  startLine?: number;
  lineCount?: number;
  contextFiles?: string[];
}

export interface InlineEditCursorRequest {
  mode: 'cursor';
  instruction: string;
  notePath: string;
  cursorContext: CursorContext;
  contextFiles?: string[];
}

export type InlineEditRequest = InlineEditSelectionRequest | InlineEditCursorRequest;

export interface InlineEditResult {
  success: boolean;
  editedText?: string;
  insertedText?: string;
  clarification?: string;
  error?: string;
}

export interface InlineEditService {
  setModelOverride?(model?: string): void;
  resetSession(): void;
  editText(request: InlineEditRequest): Promise<InlineEditResult>;
  continueSession(message: string, contextFiles?: string[]): Promise<InlineEditResult>;
  cancel(): void;
}
