import { useEffect, useRef } from 'react';

import { useT } from '../i18n';
import { ModelSelector, ThinkingSelector } from '../mount/composer/ComposerSelectors';
import type { ComposerOptionSnapshot } from '../store';

export type InlineEditStatus = 'idle' | 'streaming' | 'ready' | 'error';

export interface InlineEditBoxProps {
  model: string;
  modelOptions: readonly ComposerOptionSnapshot[];
  thinkingLevel: string;
  thinkingOptions: readonly ComposerOptionSnapshot[];
  adaptiveReasoning: boolean;
  defaultReasoningValue: string;
  prompt: string;
  status: InlineEditStatus;
  resultPreview?: string;
  errorMessage?: string;
  onPromptChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onThinkingChange: (value: string) => void;
  onSend: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}

export function InlineEditBox({
  adaptiveReasoning,
  defaultReasoningValue,
  errorMessage,
  model,
  modelOptions,
  onAccept,
  onCancel,
  onModelChange,
  onPromptChange,
  onReject,
  onSend,
  onThinkingChange,
  prompt,
  resultPreview,
  status,
  thinkingLevel,
  thinkingOptions,
}: InlineEditBoxProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const canSend = status === 'idle' && prompt.trim().length > 0;
  const isStreaming = status === 'streaming';
  const isReady = status === 'ready';
  const isError = status === 'error';

  // The textarea is disabled while streaming/ready, so accept/reject shortcuts
  // for the ready state are handled at the root element level.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !isReady) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onReject();
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onAccept();
      }
    };
    root.addEventListener('keydown', handleKeyDown);
    return () => root.removeEventListener('keydown', handleKeyDown);
  }, [isReady, onAccept, onReject]);

  return (
    <div className="pivi-inline-edit" data-pivi-react-surface="inline-edit" ref={rootRef}>
      <textarea
        aria-label={t('editor.inlineEdit.promptAria')}
        className="pivi-inline-edit-prompt"
        disabled={isStreaming || isReady}
        onChange={event => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            // When ready, Escape confirms rejection; otherwise it cancels the draft.
            if (isReady) {
              onReject();
            } else {
              onCancel();
            }
            return;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSend) {
            event.preventDefault();
            onSend();
          }
        }}
        placeholder={t('editor.inlineEdit.placeholder')}
        rows={3}
        value={prompt}
      />
      <div className="pivi-inline-edit-controls">
        <ModelSelector
          onChange={onModelChange}
          options={modelOptions}
          value={model}
        />
        <ThinkingSelector
          adaptive={adaptiveReasoning}
          defaultValue={defaultReasoningValue}
          onChange={onThinkingChange}
          options={thinkingOptions}
          value={thinkingLevel}
        />
        {isReady ? (
          <div className="pivi-inline-edit-actions">
            <button className="pivi-inline-edit-btn" onClick={onReject} type="button">
              {t('editor.inlineEdit.reject')}
            </button>
            <span aria-hidden="true" className="pivi-inline-edit-hint">
              {t('editor.inlineEdit.rejectHint')}
            </span>
            <button
              className="pivi-inline-edit-btn pivi-inline-edit-btn--primary"
              onClick={onAccept}
              type="button"
            >
              {t('editor.inlineEdit.accept')}
            </button>
            <span aria-hidden="true" className="pivi-inline-edit-hint">
              {t('editor.inlineEdit.acceptHint')}
            </span>
          </div>
        ) : (
          <button
            className="pivi-inline-edit-btn pivi-inline-edit-btn--primary"
            disabled={!canSend || isStreaming}
            onClick={onSend}
            type="button"
          >
            {isStreaming ? t('editor.inlineEdit.streaming') : t('editor.inlineEdit.send')}
          </button>
        )}
      </div>
      {isStreaming ? (
        <div aria-live="polite" className="pivi-inline-edit-status">
          {t('editor.inlineEdit.streaming')}
        </div>
      ) : null}
      {isReady && resultPreview ? (
        <div className="pivi-inline-edit-preview">{resultPreview}</div>
      ) : null}
      {isError && errorMessage ? (
        <div className="pivi-inline-edit-error" role="alert">{errorMessage}</div>
      ) : null}
    </div>
  );
}
