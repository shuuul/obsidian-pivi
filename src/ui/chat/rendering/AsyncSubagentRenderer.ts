import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';

import { setupCollapsible } from './collapsible';
import {
  applySubagentHeaderIcon,
  createSection,
  type CreateSubagentBlockOptions,
  extractTaskDescription,
  extractTaskPrompt,
  formatSubagentAgentName,
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
import { renderStoredToolStepGroup } from './ToolStepGroupRenderer';

type AsyncContentStatus = 'running' | 'completed' | 'error' | 'orphaned';

export interface AsyncSubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  progressEl: HTMLElement;
  contentStatus: AsyncContentStatus;
  contentRendered: boolean;
  contentDirty: boolean;
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
  state.labelEl.setText(formatSubagentAgentName(state.info.id, state.info.writerName));

  const statusLabel = getSubagentStatusLabel(state.info);
  const iconEl = state.headerEl.querySelector<HTMLElement>('.pivi-subagent-icon');
  if (iconEl) applySubagentHeaderIcon(iconEl, state.info);
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

  const toolCalls = subagent.toolCalls.map((originalToolCall) => ({
    ...originalToolCall,
    input: { ...originalToolCall.input },
  }));
  if (toolCalls.length > 0) {
    renderStoredToolStepGroup(toolsContainerEl, toolCalls);
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

function renderAsyncContentFromState(state: AsyncSubagentState): void {
  renderAsyncContentLikeSync(state.contentEl, state.info, state.contentStatus, state.renderContent);
  state.contentRendered = true;
  state.contentDirty = false;
}

function markAsyncContentDirty(state: AsyncSubagentState, status: AsyncContentStatus): void {
  state.contentStatus = status;
  state.contentDirty = true;
  if (!state.info.isExpanded) return;
  renderAsyncContentFromState(state);
  scrollSubagentContentToBottom(state.contentEl);
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
  headerEl.setAttribute('aria-label', `Background task: ${description} - ${getSubagentStatusLabel(info)} - click to expand`);

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  applySubagentHeaderIcon(iconEl, info);

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentAgentName(taskToolId, info.writerName));

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status status-pending' });
  renderSubagentStatus(statusEl, info);

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, info);

  const progressEl = wrapperEl.createDiv({ cls: 'pivi-subagent-progress' });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });
  const state: AsyncSubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    progressEl,
    contentStatus: 'running',
    contentRendered: false,
    contentDirty: true,
    renderContent: options.renderContent,
    info,
  };

  setupCollapsible(wrapperEl, headerEl, contentEl, info, {
    initiallyExpanded: info.isExpanded,
    onToggle: (expanded) => {
      if (!expanded) return;
      if (!state.contentRendered || state.contentDirty) {
        renderAsyncContentFromState(state);
      }
      scrollSubagentContentToBottom(contentEl);
    },
  });
  if (state.info.isExpanded) {
    renderAsyncContentFromState(state);
  }


  return state;
}

export function updateAsyncSubagentRunning(
  state: AsyncSubagentState,
  agentId: string,
  asyncStatus: 'pending' | 'running' = 'running',
): void {
  state.info.asyncStatus = asyncStatus;
  state.info.agentId = agentId || state.info.agentId;

  setAsyncWrapperStatus(state.wrapperEl, asyncStatus);
  updateAsyncLabel(state);
  renderSubagentStatus(state.statusEl, state.info);

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.removeClass('is-hidden');

  markAsyncContentDirty(state, 'running');
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
  markAsyncContentDirty(state, isError ? 'error' : 'completed');
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
  markAsyncContentDirty(state, 'orphaned');
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
  applySubagentHeaderIcon(iconEl, subagent);

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentAgentName(subagent.id, subagent.writerName));

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status' });
  renderSubagentStatus(statusEl, subagent);

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, subagent);

  const progressEl = wrapperEl.createDiv({
    cls: displayStatus === 'running' || displayStatus === 'pending'
      ? 'pivi-subagent-progress'
      : 'pivi-subagent-progress is-hidden',
  });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });
  const contentStatus = displayStatus === 'pending' ? 'running' : displayStatus;
  const renderState: AsyncSubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    progressEl,
    contentStatus,
    contentRendered: false,
    contentDirty: true,
    renderContent,
    info: { ...subagent, isExpanded: false },
  };

  setupCollapsible(wrapperEl, headerEl, contentEl, renderState.info, {
    initiallyExpanded: renderState.info.isExpanded,
    onToggle: (expanded) => {
      if (!expanded) return;
      if (!renderState.contentRendered || renderState.contentDirty) {
        renderAsyncContentFromState(renderState);
      }
      scrollSubagentContentToBottom(contentEl);
    },
  });

  return wrapperEl;
}
