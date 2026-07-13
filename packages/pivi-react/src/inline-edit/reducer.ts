import type { DiffOp } from '../diff/wordDiff';

export type InlineEditPhase = 'input' | 'generating' | 'clarification' | 'diff' | 'error' | 'cancelled';

export interface InlineEditState {
  phase: InlineEditPhase;
  clarification: string | null;
  diffOps: readonly DiffOp[] | null;
  error: string | null;
}

export const initialInlineEditState: InlineEditState = {
  phase: 'input',
  clarification: null,
  diffOps: null,
  error: null,
};

export type InlineEditAction =
  | { type: 'generate' }
  | { type: 'clarify'; message: string }
  | { type: 'diff'; diffOps: readonly DiffOp[] }
  | { type: 'error'; message: string }
  | { type: 'retry' }
  | { type: 'cancel' };

export function inlineEditReducer(state: InlineEditState, action: InlineEditAction): InlineEditState {
  switch (action.type) {
    case 'generate':
      return { phase: 'generating', clarification: null, diffOps: null, error: null };
    case 'clarify':
      return { phase: 'clarification', clarification: action.message, diffOps: null, error: null };
    case 'diff':
      return { phase: 'diff', clarification: null, diffOps: action.diffOps, error: null };
    case 'error':
      return { phase: 'error', clarification: null, diffOps: null, error: action.message };
    case 'retry':
      return initialInlineEditState;
    case 'cancel':
      return { phase: 'cancelled', clarification: null, diffOps: null, error: null };
    default:
      return state;
  }
}
