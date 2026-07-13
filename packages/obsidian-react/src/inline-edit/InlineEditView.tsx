import { useEffect, useRef, useState } from 'react';

import type { DiffOp } from '../diff/wordDiff';
import { useT } from '../i18n';
import type { InlineEditController } from './controller';
import type { InlineEditState } from './reducer';

function Diff({ ops }: { ops: readonly DiffOp[] }) {
  return <span className="pivi-inline-diff-replace">{ops.map((op, index) => (
    <span className={op.type === 'delete' ? 'pivi-diff-del' : op.type === 'insert' ? 'pivi-diff-ins' : undefined} key={`${op.type}-${index}`}>{op.text}</span>
  ))}</span>;
}

export function InlineEditView({ controller, onAccept, onReject }: {
  controller: InlineEditController;
  onAccept: (text: string) => void;
  onReject: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<InlineEditState>(controller.state);
  const [instruction, setInstruction] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { inputRef.current?.focus(); }, [state.phase]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); controller.reject(); onReject(); }
      if (event.key === 'Enter' && state.phase === 'diff') {
        const text = controller.accept();
        if (text !== null) { event.preventDefault(); onAccept(text); }
      }
    };
    const ownerDocument = inputRef.current?.ownerDocument;
    ownerDocument?.addEventListener('keydown', onKeyDown);
    return () => ownerDocument?.removeEventListener('keydown', onKeyDown);
  }, [controller, onAccept, onReject, state.phase]);

  if (state.phase === 'diff' && state.diffOps) {
    return <span className="pivi-inline-diff-replace"><Diff ops={state.diffOps} /><span className="pivi-inline-diff-buttons">
      <button className="pivi-inline-diff-btn reject" type="button" onClick={() => { controller.reject(); onReject(); }}>✕</button>
      <button className="pivi-inline-diff-btn accept" type="button" onClick={() => { const text = controller.accept(); if (text !== null) onAccept(text); }}>✓</button>
    </span></span>;
  }
  const placeholder = state.phase === 'clarification'
    ? t('inlineEdit.placeholderReply')
    : controller.mode === 'cursor'
      ? t('inlineEdit.placeholderInsert')
      : t('inlineEdit.placeholderEdit');
  return <div className={`pivi-inline-input-container${state.phase === 'clarification' ? ' has-agent-reply' : ''}`}>
    {state.clarification && <div className="pivi-inline-agent-reply">{state.clarification}</div>}
    <div className="pivi-inline-input-wrap">
      <input ref={inputRef} className="pivi-inline-input" type="text" spellCheck={false} disabled={state.phase === 'generating'} value={instruction} placeholder={state.phase === 'error' ? state.error || t('common.error') : placeholder}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void controller.generate(instruction); setInstruction(''); } }} />
      {state.phase === 'generating' && <div className="pivi-inline-spinner" />}
    </div>
  </div>;
}
