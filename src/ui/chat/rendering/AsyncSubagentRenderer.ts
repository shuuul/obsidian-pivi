import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';

import { t } from '@/app/i18n';

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
  nextMarkdownRenderGeneration,
  renderSubagentMarkdownWithFallback,
  renderSubagentStatus,
  scrollSubagentContentToBottom,
  setPromptText,
  type SubagentDisplayStatus,
  type SubagentRenderContentFn,
  updateSubagentHeaderDisplay,
  updateSummaryText,
} from './subagentRendererShared';
import type { ToolContentRenderOptions } from './ToolCallRenderer';
import { renderStoredToolRuns } from './ToolStepGroupRenderer';

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

interface AsyncSubagentShell {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  progressEl: HTMLElement;
}

interface AsyncSubagentShellOptions {
  info: SubagentInfo;
  displayStatus: SubagentDisplayStatus;
  progressVisible: boolean;
  initiallyExpanded: boolean;
  ariaDescription: string;
}

function setAsyncWrapperStatus(wrapperEl: HTMLElement, status: string): void {
  const classes = ['pending', 'queued', 'running', 'waiting', 'awaiting', 'completed', 'failed', 'cancelled', 'error', 'orphaned', 'async'];
  classes.forEach(cls => wrapperEl.removeClass(cls));
  wrapperEl.addClass('async');
  wrapperEl.addClass(status);
}

function updateAsyncLabel(state: AsyncSubagentState): void {
  updateSubagentHeaderDisplay({
    headerEl: state.headerEl,
    labelEl: state.labelEl,
    summaryEl: state.summaryEl,
    statusEl: state.statusEl,
    info: state.info,
    ariaLabelPrefix: t('chat.activity.backgroundTask'),
  });
}

function createAsyncSubagentShell(
  parentEl: HTMLElement,
  options: AsyncSubagentShellOptions,
): AsyncSubagentShell {
  const { info, displayStatus, progressVisible, initiallyExpanded, ariaDescription } = options;
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item' });
  setAsyncWrapperStatus(wrapperEl, displayStatus);
  wrapperEl.dataset.asyncSubagentId = info.id;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });
  headerEl.setAttribute('aria-expanded', initiallyExpanded ? 'true' : 'false');
  headerEl.setAttribute(
    'aria-label',
    `${t('chat.activity.backgroundTask')}: ${ariaDescription} - ${getSubagentStatusLabel(info)} - ${t('chat.activity.expand')}`,
  );

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  applySubagentHeaderIcon(iconEl, info);

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentAgentName(info.id, info.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, info);

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status' });
  renderSubagentStatus(statusEl, info);

  const progressEl = wrapperEl.createDiv({
    cls: progressVisible ? 'pivi-subagent-progress' : 'pivi-subagent-progress is-hidden',
  });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });

  return { wrapperEl, contentEl, headerEl, labelEl, summaryEl, statusEl, progressEl };
}

function renderAsyncContentLikeSync(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
  renderContent?: SubagentRenderContentFn,
): void {
  const generation = nextMarkdownRenderGeneration(contentEl);
  contentEl.empty();

  const promptSection = createSection(contentEl, t('chat.activity.prompt'), 'pivi-subagent-prompt-body');
  promptSection.wrapperEl.addClass('pivi-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, subagent.prompt || '', renderContent, contentEl);

  const toolsContainerEl = contentEl.createDiv({ cls: 'pivi-subagent-tools' });

  const toolCalls = subagent.toolCalls.map((originalToolCall) => ({
    ...originalToolCall,
    input: { ...originalToolCall.input },
  }));
  if (toolCalls.length > 0) {
    const renderOptions: ToolContentRenderOptions = renderContent
      ? {
          renderMarkdown: (container, markdown, sourcePath) => (
            renderContent(container, markdown, { sourcePath })
          ),
        }
      : {};
    renderStoredToolRuns(toolsContainerEl, toolCalls, renderOptions);
  }

  if (displayStatus === 'running' && !subagent.result?.trim()) {
    return;
  }

  const resultSection = createSection(contentEl, t('chat.activity.result'), 'pivi-subagent-result-body');
  resultSection.wrapperEl.addClass('pivi-subagent-section-result');
  const resultEl = resultSection.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });

  if (displayStatus === 'orphaned') {
    renderSubagentMarkdownWithFallback({
      generationEl: contentEl,
      targetEl: resultEl,
      text: subagent.result || t('chat.activity.sessionEnded'),
      renderContent,
      scrollContainerEl: contentEl,
      generation,
    });
    return;
  }

  const fallback = displayStatus === 'error'
    ? t('chat.activity.error')
    : t('chat.activity.done');
  const finalText = subagent.result?.trim() ? subagent.result : fallback;
  renderSubagentMarkdownWithFallback({
    generationEl: contentEl,
    targetEl: resultEl,
    text: finalText,
    renderContent,
    scrollContainerEl: contentEl,
    generation,
  });
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

  const shell = createAsyncSubagentShell(parentEl, {
    info,
    displayStatus: 'queued',
    progressVisible: true,
    initiallyExpanded: info.isExpanded,
    ariaDescription: description,
  });
  const state: AsyncSubagentState = {
    wrapperEl: shell.wrapperEl,
    contentEl: shell.contentEl,
    headerEl: shell.headerEl,
    labelEl: shell.labelEl,
    summaryEl: shell.summaryEl,
    statusEl: shell.statusEl,
    progressEl: shell.progressEl,
    contentStatus: 'running',
    contentRendered: false,
    contentDirty: true,
    renderContent: options.renderContent,
    info,
  };

  setupCollapsible(shell.wrapperEl, shell.headerEl, shell.contentEl, info, {
    initiallyExpanded: info.isExpanded,
    onToggle: (expanded) => {
      if (!expanded) return;
      if (!state.contentRendered || state.contentDirty) {
        renderAsyncContentFromState(state);
      }
      scrollSubagentContentToBottom(shell.contentEl);
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

  setAsyncWrapperStatus(state.wrapperEl, asyncStatus === 'pending' ? 'queued' : asyncStatus);
  updateAsyncLabel(state);
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
  state.info.result = t('chat.activity.sessionEnded');

  setAsyncWrapperStatus(state.wrapperEl, 'orphaned');
  updateAsyncLabel(state);
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
  const displayStatus = getSubagentDisplayStatus(subagent);
  const shell = createAsyncSubagentShell(parentEl, {
    info: subagent,
    displayStatus,
    progressVisible: displayStatus === 'running' || displayStatus === 'queued',
    initiallyExpanded: false,
    ariaDescription: subagent.description,
  });

  if (displayStatus === 'completed') {
    shell.wrapperEl.addClass('done');
  } else if (displayStatus === 'failed' || displayStatus === 'cancelled' || displayStatus === 'orphaned') {
    shell.wrapperEl.addClass('error');
  }

  const contentStatus = displayStatus === 'queued' || displayStatus === 'waiting'
    ? 'running'
    : displayStatus === 'failed' || displayStatus === 'cancelled'
      ? 'error'
      : displayStatus;
  const renderState: AsyncSubagentState = {
    wrapperEl: shell.wrapperEl,
    contentEl: shell.contentEl,
    headerEl: shell.headerEl,
    labelEl: shell.labelEl,
    summaryEl: shell.summaryEl,
    statusEl: shell.statusEl,
    progressEl: shell.progressEl,
    contentStatus,
    contentRendered: false,
    contentDirty: true,
    renderContent,
    info: { ...subagent, isExpanded: false },
  };

  setupCollapsible(shell.wrapperEl, shell.headerEl, shell.contentEl, renderState.info, {
    initiallyExpanded: renderState.info.isExpanded,
    onToggle: (expanded) => {
      if (!expanded) return;
      if (!renderState.contentRendered || renderState.contentDirty) {
        renderAsyncContentFromState(renderState);
      }
      scrollSubagentContentToBottom(shell.contentEl);
    },
  });

  return shell.wrapperEl;
}
