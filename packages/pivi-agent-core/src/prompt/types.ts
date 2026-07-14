import type { BrowserSelectionContext } from '../context/browser';
import type { CanvasSelectionContext } from '../context/canvas';
import type { EditorSelectionContext } from '../context/editor';
import type { InlineContextReference } from '../context/inlineContext';
import type { ImageAttachment } from '../foundation';

export interface ChatTurnRequest {
  text: string;
  images?: ImageAttachment[];
  currentNotePath?: string;
  attachedFilePaths?: string[];
  editorSelection?: EditorSelectionContext | null;
  browserSelection?: BrowserSelectionContext | null;
  canvasSelection?: CanvasSelectionContext | null;
  inlineContexts?: InlineContextReference[];
  externalContextPaths?: string[];
  enabledMcpServers?: Set<string>;
}

export interface BuiltTurnPrompt {
  prompt: string;
  persistedContent: string;
  isCompact: boolean;
}

export interface ExternalContextAvailability {
  path: string;
  available: boolean;
  reason?: string;
}

export interface PromptContributor {
  contributePrompt(): string | null | undefined;
}

export interface ContextProvider<TContext> {
  getContext(): TContext | null | undefined;
}
