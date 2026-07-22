import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

/** Payload emitted when the user submits the inline edit prompt. */
export interface InlineEditSurfaceSendPayload {
  prompt: string;
  contextFiles: string[];
  model: string;
  thinkingLevel: string;
}

export type InlineEditDiffReviewKind = 'replacement' | 'insertion';

/** Opaque identity for one persistent inline-edit surface. */
export type InlineEditSurfaceSessionId = string & { readonly __inlineEditSurfaceSessionId: unique symbol };

export interface InlineEditSurfaceSessionOptions {
  onSend?: (payload: InlineEditSurfaceSendPayload) => void;
  onReject?: () => void;
  onDiffReject?: () => void;
  onAccept?: () => void;
  onStop?: () => void;
}

export interface InlineEditSurfaceComposerState {
  model: string;
  thinkingLevel: string;
}

/** Active inline edit surface bound to one editor selection. */
export interface InlineEditSurfaceSessionContract {
  readonly id: InlineEditSurfaceSessionId;
  onSend?: (payload: InlineEditSurfaceSendPayload) => void;
  onReject?: () => void;
  onDiffReject?: () => void;
  onAccept?: () => void;
  onStop?: () => void;

  show(snapshot: EditorSelectionSnapshot): void;
  destroy(): void;
  isDestroyed(): boolean;
  setStreaming(streaming: boolean): void;
  setReplyText(text: string): void;
  showError(message: string): void;
  showDiffReview(oldText: string, newText: string, kind: InlineEditDiffReviewKind): void;
  getComposerState(): InlineEditSurfaceComposerState;
  setPrompt(text: string): void;
}
