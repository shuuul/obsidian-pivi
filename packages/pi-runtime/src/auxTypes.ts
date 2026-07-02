import type { InlineEditRequest, InlineEditResult } from './prompt/inlineEdit';

export type {
  InlineEditCursorRequest,
  InlineEditMode,
  InlineEditRequest,
  InlineEditResult,
  InlineEditSelectionRequest,
} from './prompt/inlineEdit';

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

export interface InlineEditService {
  setModelOverride?(model?: string): void;
  resetSession(): void;
  editText(request: InlineEditRequest): Promise<InlineEditResult>;
  continueSession(message: string, contextFiles?: string[]): Promise<InlineEditResult>;
  cancel(): void;
}
