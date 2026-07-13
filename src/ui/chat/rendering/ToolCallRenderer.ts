import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isWriteEditTool,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_TODO_WRITE,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { getToolPresentationDescriptor } from '@pivi/pivi-agent-core/tools/toolPresentation';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import { t } from '@/app/i18n';

import { setupCollapsible } from './collapsible';
import { renderDiffStats } from './DiffRenderer';
import {
  renderAskUserQuestionFallback,
  renderAskUserQuestionResult,
} from './toolCallAskUserExpanded';
import { renderBashContent } from './toolCallBashAndMiscExpanded';
import { renderExpandedContent } from './toolCallExpandedDispatcher';
import { appendToolIcon } from './toolCallIcon';
import { syncObsidianToolHeader } from './toolCallObsidianExpanded';
import { resolveMarkdownReadPreview } from './toolCallReadPreview';
import {
  createCurrentTaskPreview,
  createTodoToggleHandler,
  getCurrentTask,
  renderTodoWriteResult,
  setGenericToolHeaderRight,
  setTodoWriteStatus,
} from './toolCallTodoWrite';
import { getToolLabel, getToolName, getToolSummary } from './toolPresentationI18n';
import { findToolStepGroupState } from './toolStepGroupState';
import { renderWriteEditContent } from './WriteEditRenderer';

export { renderExpandedContent } from './toolCallExpandedDispatcher';
export { getToolLabel, getToolName, getToolStepPhrase, getToolSummary } from './toolPresentationI18n';

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

export interface ToolContentRenderOptions {
  renderMarkdown?: (container: HTMLElement, markdown: string, sourcePath: string) => Promise<void>;
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
  const descriptor = getToolPresentationDescriptor(toolCall.name);
  if (descriptor.className) toolEl.addClass(`pivi-tool-call-${descriptor.className}`);

  const header = toolEl.createDiv({ cls: 'pivi-tool-header' });

  const iconEl = header.createSpan({ cls: 'pivi-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  appendToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'pivi-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input, toolCall.result));

  const summaryEl = header.createSpan({ cls: 'pivi-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input, toolCall.result));

  const diffStatsEl = isWriteEditTool(toolCall.name)
    ? header.createSpan({ cls: 'pivi-write-edit-stats' })
    : null;
  if (diffStatsEl && toolCall.diffData) {
    renderDiffStats(diffStatsEl, toolCall.diffData.stats);
  }

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  const statusEl = header.createSpan({ cls: 'pivi-tool-status' });

  const content = toolEl.createDiv({ cls: 'pivi-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}


export function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string,
  options: ToolContentRenderOptions = {},
): void | Promise<void> {
  if (isWriteEditTool(toolCall.name)) {
    renderWriteEditContent(content, toolCall);
  } else if (toolCall.name === TOOL_TODO_WRITE) {
    content.addClass('pivi-tool-content-todo');
    renderTodoWriteResult(content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('pivi-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, 'Waiting for answer...');
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (toolCall.name === TOOL_BASH) {
    renderBashContent(content, toolCall.input, toolCall.result ?? '', initialText);
  } else if (initialText) {
    const resultRow = content.createDiv({ cls: 'pivi-tool-result-row' });
    const resultText = resultRow.createSpan({ cls: 'pivi-tool-result-text' });
    resultText.setText(initialText);
  } else {
    const markdownPreview = options.renderMarkdown
      ? resolveMarkdownReadPreview(toolCall)
      : null;
    if (markdownPreview && options.renderMarkdown) {
      const previewEl = content.createDiv({ cls: 'pivi-tool-read-markdown' });
      return options.renderMarkdown(
        previewEl,
        markdownPreview.markdown,
        markdownPreview.sourcePath,
      ).then(() => {
        if (markdownPreview.omittedLines > 0 && previewEl.parentElement === content) {
          content.createDiv({
            cls: 'pivi-tool-truncated',
            text: t('chat.stream.moreLines', { count: markdownPreview.omittedLines }),
          });
        }
      });
    }
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input, toolCall.toolUseResult);
  }
}

export function isBlockedToolResult(content: unknown, isError?: boolean): boolean {
  const lower = extractToolResultContent(content, { fallbackIndent: 2 }).toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
  options: ToolContentRenderOptions = {},
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setGenericToolHeaderRight(statusEl, toolCall);

  void renderToolContent(content, toolCall, 'Running...', options);

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input, toolCall.result)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}

export function updateToolCallElement(
  toolEl: HTMLElement,
  toolCall: ToolCallInfo,
  options: ToolContentRenderOptions = {},
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.pivi-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(content, toolCall.input);
    }
    const nameEl = toolEl.querySelector('.pivi-tool-name') as HTMLElement;
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input, toolCall.result));
    }
    const currentTaskEl = toolEl.querySelector('.pivi-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.setText(currentTask ? (currentTask.activeForm ?? currentTask.content) : '');
    }
    return;
  }

  const statusEl = toolEl.querySelector('.pivi-tool-status') as HTMLElement;
  if (statusEl) {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  const diffStatsEl = toolEl.querySelector<HTMLElement>('.pivi-write-edit-stats');
  if (diffStatsEl) {
    diffStatsEl.empty();
    if (toolCall.diffData) renderDiffStats(diffStatsEl, toolCall.diffData.stats);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
    if (content) {
      content.addClass('pivi-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.pivi-tool-content') as HTMLElement;
  if (content) {
    content.empty();
    void renderToolContent(content, toolCall, undefined, options);
  }

  syncObsidianToolHeader(toolEl, toolCall);
}

export function tryUpdateToolInStepGroup(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>,
): boolean {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl?.classList.contains('pivi-tool-call-in-step-group')) return false;

  const state = findToolStepGroupState(toolEl);
  updateToolCallElement(toolEl, toolCall, state?.renderOptions);
  state?.updateToolCall(toolId, toolCall);
  return true;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  if (tryUpdateToolInStepGroup(toolId, toolCall, toolCallElements)) {
    return;
  }

  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;
  updateToolCallElement(toolEl, toolCall);
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  options: ToolContentRenderOptions = {},
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  void renderToolContent(content, toolCall, undefined, options);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input, toolCall.result)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}
