import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';
import { getToolIcon } from '@pivi/pivi-agent-core/tools/toolIcons';
import { TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { setIcon } from 'obsidian';

import { setupCollapsible } from './collapsible';
import {
  createSection,
  type CreateSubagentBlockOptions,
  createSubagentToolView,
  extractTaskDescription,
  extractTaskPrompt,
  formatSubagentTitle,
  getSubagentDisplayStatus,
  getSubagentStatusLabel,
  isCurrentMarkdownRenderGeneration,
  nextMarkdownRenderGeneration,
  renderSubagentStatus,
  scrollSubagentContentToBottom,
  setPromptText,
  type SubagentRenderContentFn,
  truncateDescription,
  updateSummaryText,
} from './subagentRendererShared';

export interface AsyncSubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  progressEl: HTMLElement;
  renderContent?: SubagentRenderContentFn;
  info: SubagentInfo;
}

function setAsyncWrapperStatus(wrapperEl: HTMLElement, status: string): void {
  const classes = ['pending', 'running', 'awaiting', 'completed', 'error', 'orphaned', 'async'];
  classes.forEach(cls => wrapperEl.removeClass(cls));
  wrapperEl.addClass('async');
  wrapperEl.addClass(status);
}

function updateAsyncLabel(state: AsyncSubagentState): void {
  state.labelEl.setText(formatSubagentTitle(state.info.id, state.info.description, state.info.writerName));

  const statusLabel = getSubagentStatusLabel(state.info);
  state.headerEl.setAttribute(
    'aria-label',
    `Background task: ${truncateDescription(state.info.description)} - ${statusLabel} - click to expand`
  );
}

function renderMarkdownResult(
  containerEl: HTMLElement,
  resultEl: HTMLElement,
  text: string,
  renderContent?: SubagentRenderContentFn,
): void {
  if (!renderContent) {
    resultEl.setText(text);
    scrollSubagentContentToBottom(containerEl);
    return;
  }

  const generation = containerEl.dataset.piviMarkdownRenderGeneration ?? '';
  void renderContent(resultEl, text).then(() => {
    if (!isCurrentMarkdownRenderGeneration(containerEl, generation)) {
      resultEl.remove();
      return;
    }
    scrollSubagentContentToBottom(containerEl);
  }).catch(() => {
    if (!isCurrentMarkdownRenderGeneration(containerEl, generation)) return;
    resultEl.setText(text);
    scrollSubagentContentToBottom(containerEl);
  });
}

function renderAsyncContentLikeSync(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
  renderContent?: SubagentRenderContentFn,
): void {
  nextMarkdownRenderGeneration(contentEl);
  contentEl.empty();

  const promptSection = createSection(contentEl, 'Prompt', 'pivi-subagent-prompt-body');
  promptSection.wrapperEl.addClass('pivi-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, subagent.prompt || '', renderContent, contentEl);

  const toolsContainerEl = contentEl.createDiv({ cls: 'pivi-subagent-tools' });
  for (const originalToolCall of subagent.toolCalls) {
    createSubagentToolView(toolsContainerEl, {
      ...originalToolCall,
      input: { ...originalToolCall.input },
    });
  }

  if (displayStatus === 'running' && !subagent.result?.trim()) {
    return;
  }

  const resultSection = createSection(contentEl, 'Result', 'pivi-subagent-result-body');
  resultSection.wrapperEl.addClass('pivi-subagent-section-result');
  const resultEl = resultSection.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });

  if (displayStatus === 'orphaned') {
    renderMarkdownResult(
      contentEl,
      resultEl,
      subagent.result || 'Session ended before task completed',
      renderContent,
    );
    return;
  }

  const fallback = displayStatus === 'error' ? 'ERROR' : 'DONE';
  const finalText = subagent.result?.trim() ? subagent.result : fallback;
  renderMarkdownResult(contentEl, resultEl, finalText, renderContent);
}

/**
 * Create an async subagent block for a background Agent tool call.
 * Expandable to show the task prompt. Collapsed by default.
 */
export function createAsyncSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
  options: CreateSubagentBlockOptions = {},
): AsyncSubagentState {
  const description = extractTaskDescription(taskInput);
  const prompt = extractTaskPrompt(taskInput);

  const info: SubagentInfo = {
    id: taskToolId,
    writerName: options.writerName,
    description,
    prompt,
    mode: 'async',
    status: 'running',
    toolCalls: [],
    isExpanded: options.initiallyExpanded ?? false,
    asyncStatus: 'pending',
  };

  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item' });
  setAsyncWrapperStatus(wrapperEl, 'pending');
  wrapperEl.dataset.asyncSubagentId = taskToolId;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', info.isExpanded ? 'true' : 'false');
  headerEl.setAttribute('aria-label', `Background task: ${description} - Initializing - click to expand`);

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentTitle(taskToolId, description, info.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, info);

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status status-pending' });
  renderSubagentStatus(statusEl, info);

  const progressEl = wrapperEl.createDiv({ cls: 'pivi-subagent-progress' });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });
  renderAsyncContentLikeSync(contentEl, info, 'running', options.renderContent);

  setupCollapsible(wrapperEl, headerEl, contentEl, info, {
    initiallyExpanded: info.isExpanded,
    onToggle: (expanded) => {
      if (expanded) scrollSubagentContentToBottom(contentEl);
    },
  });

  return {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    progressEl,
    renderContent: options.renderContent,
    info,
  };
}

export function updateAsyncSubagentRunning(
  state: AsyncSubagentState,
  agentId: string
): void {
  state.info.asyncStatus = 'running';
  state.info.agentId = agentId;

  setAsyncWrapperStatus(state.wrapperEl, 'running');
  updateAsyncLabel(state);
  renderSubagentStatus(state.statusEl, state.info);

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.removeClass('is-hidden');

  renderAsyncContentLikeSync(state.contentEl, state.info, 'running', state.renderContent);
  scrollSubagentContentToBottom(state.contentEl);
}

export function finalizeAsyncSubagent(
  state: AsyncSubagentState,
  result: string,
  isError: boolean
): void {
  state.info.asyncStatus = isError ? 'error' : 'completed';
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  setAsyncWrapperStatus(state.wrapperEl, isError ? 'error' : 'completed');
  updateAsyncLabel(state);
  renderSubagentStatus(state.statusEl, state.info);

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.addClass('is-hidden');

  if (isError) {
    state.wrapperEl.addClass('error');
  } else {
    state.wrapperEl.addClass('done');
  }

  renderAsyncContentLikeSync(state.contentEl, state.info, isError ? 'error' : 'completed', state.renderContent);
}

export function markAsyncSubagentOrphaned(state: AsyncSubagentState): void {
  state.info.asyncStatus = 'orphaned';
  state.info.status = 'error';
  state.info.result = 'Session ended before task completed';

  setAsyncWrapperStatus(state.wrapperEl, 'orphaned');
  updateAsyncLabel(state);
  renderSubagentStatus(state.statusEl, state.info);

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.addClass('is-hidden');

  state.wrapperEl.addClass('error');
  state.wrapperEl.addClass('orphaned');

  renderAsyncContentLikeSync(state.contentEl, state.info, 'orphaned', state.renderContent);
}

/**
 * Render a stored async subagent from session history.
 * Expandable to show the task prompt. Collapsed by default.
 */
export function renderStoredAsyncSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  renderContent?: SubagentRenderContentFn,
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item' });
  const displayStatus = getSubagentDisplayStatus(subagent);
  setAsyncWrapperStatus(wrapperEl, displayStatus);

  if (displayStatus === 'completed') {
    wrapperEl.addClass('done');
  } else if (displayStatus === 'error' || displayStatus === 'orphaned') {
    wrapperEl.addClass('error');
  }
  wrapperEl.dataset.asyncSubagentId = subagent.id;

  const statusAriaLabel = getSubagentStatusLabel(subagent);

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');
  headerEl.setAttribute('aria-expanded', 'false');
  headerEl.setAttribute(
    'aria-label',
    `Background task: ${subagent.description} - ${statusAriaLabel} - click to expand`
  );

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentTitle(subagent.id, subagent.description, subagent.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, subagent);

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status' });
  renderSubagentStatus(statusEl, subagent);

  const progressEl = wrapperEl.createDiv({
    cls: displayStatus === 'running' || displayStatus === 'pending'
      ? 'pivi-subagent-progress'
      : 'pivi-subagent-progress is-hidden',
  });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });
  const contentStatus = displayStatus === 'pending' ? 'running' : displayStatus;
  renderAsyncContentLikeSync(contentEl, subagent, contentStatus, renderContent);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state, {
    initiallyExpanded: state.isExpanded,
    onToggle: (expanded) => {
      if (expanded) scrollSubagentContentToBottom(contentEl);
    },
  });

  return wrapperEl;
}
