import type { CursorContext } from '@pivi/pivi-agent-core/context/editor';
import type { InlineEditResult, InlineEditService } from '@pivi/pivi-agent-core/runtime/auxTypes';
import { QueryBackedInlineEditService } from '@pivi/pivi-agent-core/runtime/queryBackedInlineEditService';

import { computeDiff, type DiffOp } from '../diff/wordDiff';
import type { InlineEditPort } from '../ports';
import { initialInlineEditState, inlineEditReducer, type InlineEditState } from './reducer';

export type InlineEditContext =
  | { mode: 'selection'; selectedText: string; startLine?: number }
  | { mode: 'cursor'; cursorContext: CursorContext };

export type InlineEditDecision = 'accept' | 'reject';

export interface InlineEditControllerOptions {
  context: InlineEditContext;
  notePath: string;
  contextFiles?: () => string[];
  service?: InlineEditService;
  modelOverride?: string | null;
  onStateChange?: (state: InlineEditState) => void;
}

export interface InlineEditController {
  readonly state: InlineEditState;
  readonly replacement: string | null;
  readonly mode: InlineEditContext['mode'];
  generate(instruction: string): Promise<void>;
  accept(): string | null;
  reject(): void;
  cancel(): void;
  subscribe(listener: (state: InlineEditState) => void): () => void;
}

function normalizeInsertionText(text: string): string {
  return text.replace(/^\n+|\n+$/g, '');
}

export function createInlineEditController(
  port: InlineEditPort,
  options: InlineEditControllerOptions,
): InlineEditController {
  const service = options.service ?? new QueryBackedInlineEditService(port.createAuxQueryRunner());
  service.setModelOverride?.(options.modelOverride ?? undefined);
  let state = initialInlineEditState;
  let replacement: string | null = null;
  let conversing = false;
  let disposed = false;
  const listeners = new Set<(next: InlineEditState) => void>();

  const publish = (next: InlineEditState) => {
    state = next;
    options.onStateChange?.(next);
    listeners.forEach((listener) => listener(next));
  };
  const dispatch = (action: Parameters<typeof inlineEditReducer>[1]) => publish(inlineEditReducer(state, action));
  const contextFiles = () => options.contextFiles?.() ?? [];

  const handleResult = (result: InlineEditResult) => {
    if (disposed) return;
    if (!result.success) {
      dispatch({ type: 'error', message: result.error ?? '' });
      return;
    }
    if (result.clarification !== undefined) {
      conversing = true;
      dispatch({ type: 'clarify', message: result.clarification });
      return;
    }
    const text = result.editedText ?? (result.insertedText === undefined ? undefined : normalizeInsertionText(result.insertedText));
    if (text === undefined) {
      dispatch({ type: 'error', message: '' });
      return;
    }
    replacement = text;
    const original = options.context.mode === 'selection' ? options.context.selectedText : '';
    const diffOps: DiffOp[] = options.context.mode === 'selection'
      ? computeDiff(original, text)
      : [{ type: 'insert', text }];
    dispatch({ type: 'diff', diffOps });
  };

  return {
    get state() { return state; },
    get mode() { return options.context.mode; },
    get replacement() { return replacement; },
    async generate(instruction) {
      const trimmed = instruction.trim();
      if (!trimmed || disposed || state.phase === 'generating') return;
      dispatch({ type: 'generate' });
      try {
        const result = conversing
          ? await service.continueSession(trimmed, contextFiles())
          : options.context.mode === 'selection'
            ? await service.editText({
                mode: 'selection', instruction: trimmed, notePath: options.notePath,
                selectedText: options.context.selectedText, startLine: options.context.startLine,
                lineCount: options.context.selectedText.split(/\r?\n/).length, contextFiles: contextFiles(),
              })
            : await service.editText({
                mode: 'cursor', instruction: trimmed, notePath: options.notePath,
                cursorContext: options.context.cursorContext, contextFiles: contextFiles(),
              });
        handleResult(result);
      } catch (error) {
        if (!disposed) dispatch({ type: 'error', message: error instanceof Error ? error.message : '' });
      }
    },
    accept() {
      if (state.phase !== 'diff') return null;
      const accepted = replacement;
      service.cancel();
      service.resetSession();
      disposed = true;
      return accepted;
    },
    reject() { this.cancel(); },
    cancel() {
      if (disposed) return;
      disposed = true;
      service.cancel();
      service.resetSession();
      dispatch({ type: 'cancel' });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
