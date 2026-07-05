import type { ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import { setupCollapsible } from './collapsible';
import {
  renderAskUserQuestionFallback,
  renderAskUserQuestionResult,
} from './toolCallAskUserExpanded';
import { renderBashContent } from './toolCallBashAndMiscExpanded';
import { renderExpandedContent } from './toolCallExpandedDispatcher';
import { appendToolIcon } from './toolCallIcon';
import { getToolLabel, getToolName, getToolSummary } from './toolCallLabels';
import { syncObsidianToolHeader } from './toolCallObsidianExpanded';
import {
  createCurrentTaskPreview,
  createTodoToggleHandler,
  getCurrentTask,
  renderTodoWriteResult,
  setGenericToolHeaderRight,
  setTodoWriteStatus,
} from './toolCallTodoWrite';

export { renderExpandedContent } from './toolCallExpandedDispatcher';
export { fileNameOnly, getToolLabel, getToolName, getToolSummary } from './toolCallLabels';

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

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'pivi-tool-call' });
  if (toolCall.name === TOOL_BASH) {
    toolEl.addClass('pivi-tool-call-bash');
  }
  if (toolCall.name === TOOL_WEB_SEARCH || toolCall.name === TOOL_WEB_FETCH) {
    toolEl.addClass('pivi-tool-call-web');
  }

  const header = toolEl.createDiv({ cls: 'pivi-tool-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'pivi-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  appendToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'pivi-tool-name' });
  nameEl.setText(getToolName(toolCall.name, toolCall.input));

  const summaryEl = header.createSpan({ cls: 'pivi-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  const statusEl = header.createSpan({ cls: 'pivi-tool-status' });

  const content = toolEl.createDiv({ cls: 'pivi-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, statusEl, content, currentTaskEl };
}


function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
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
  toolCallElements: Map<string, HTMLElement>
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setGenericToolHeaderRight(statusEl, toolCall);

  renderToolContent(content, toolCall, 'Running...');

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

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
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
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
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input, toolCall.toolUseResult);
  }

  syncObsidianToolHeader(toolEl, toolCall);
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  syncObsidianToolHeader(toolEl, toolCall);

  return toolEl;
}