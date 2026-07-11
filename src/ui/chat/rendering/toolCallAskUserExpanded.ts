import type { AskUserQuestionItem, AskUserQuestionOption, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { extractResolvedAnswersFromResultText } from '@pivi/pivi-agent-core/tools/toolInput';

import { t } from '@/i18n';

import { contentFallback } from './toolCallExpandedShared';

export function formatAnswer(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  return '';
}

export function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

export function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const questions = toolCall.input.questions as AskUserQuestionItem[] | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const reviewEl = container.createDiv({ cls: 'pivi-ask-review' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q) continue;
    const answer = formatAnswer(
      (q.id ? answers[q.id] : undefined) ?? answers[q.question]
    );
    const pairEl = reviewEl.createDiv({ cls: 'pivi-ask-review-pair' });
    pairEl.createDiv({ text: `${i + 1}.`, cls: 'pivi-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'pivi-ask-review-body' });
    bodyEl.createDiv({ text: q.question, cls: 'pivi-ask-review-q-text' });
    bodyEl.createDiv({
      text: answer || 'Not answered',
      cls: answer ? 'pivi-ask-review-a-text' : 'pivi-ask-review-empty',
    });
  }

  return true;
}

export function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  container.empty();

  const questions = Array.isArray(toolCall.input.questions)
    ? toolCall.input.questions as AskUserQuestionItem[]
    : [];

  if (questions.length === 0) {
    contentFallback(container, initialText || toolCall.result || 'Waiting for answer...');
    return;
  }

  if (initialText || toolCall.result) {
    container.createDiv({
      cls: 'pivi-ask-review-prompt',
      text: initialText || toolCall.result || 'Waiting for answer...',
    });
  }

  for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
    const question = questions[questionIndex];
    if (!question) continue;
    const reviewEl = container.createDiv({ cls: 'pivi-ask-review' });
    const pairEl = reviewEl.createDiv({ cls: 'pivi-ask-review-pair' });
    pairEl.createDiv({ text: `${questionIndex + 1}.`, cls: 'pivi-ask-review-num' });
    const bodyEl = pairEl.createDiv({ cls: 'pivi-ask-review-body' });
    bodyEl.createDiv({ text: question.question, cls: 'pivi-ask-review-q-text' });

    if (!Array.isArray(question.options) || question.options.length === 0) {
      bodyEl.createDiv({ cls: 'pivi-ask-review-empty', text: t('chat.stream.noOptionsRecorded') });
      continue;
    }

    const listEl = bodyEl.createDiv({ cls: 'pivi-ask-list' });
    question.options.forEach((option, optionIndex) => {
      renderAskUserQuestionOption(listEl, option, optionIndex, question.multiSelect === true);
    });
  }
}

export function renderAskUserQuestionOption(
  parentEl: HTMLElement,
  option: AskUserQuestionOption,
  optionIndex: number,
  isMultiSelect: boolean,
): void {
  const itemEl = parentEl.createDiv({ cls: 'pivi-ask-item is-disabled' });

  if (isMultiSelect) {
    itemEl.createDiv({ cls: 'pivi-ask-check', text: '[ ] ' });
  } else {
    itemEl.createDiv({ cls: 'pivi-ask-item-num', text: `${optionIndex + 1}. ` });
  }

  const contentEl = itemEl.createDiv({ cls: 'pivi-ask-item-content' });
  const labelRowEl = contentEl.createDiv({ cls: 'pivi-ask-label-row' });
  labelRowEl.createDiv({ cls: 'pivi-ask-item-label', text: option.label });

  if (option.description) {
    contentEl.createDiv({ cls: 'pivi-ask-item-desc', text: option.description });
  }
}
