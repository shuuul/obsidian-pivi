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
  getVisibleSubagentResult,
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
  contentStatus: AsyncContentStatus;
  contentRendered: boolean;
  contentDirty: boolean;
  renderContent?: SubagentRenderContentFn;
  beginDisclosureResize?: (header: HTMLElement) => void;
  info: SubagentInfo;
}

interface AsyncSubagentShell {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
}

interface AsyncSubagentShellOptions {
  info: SubagentInfo;
  displayStatus: SubagentDisplayStatus;
  initiallyExpanded: boolean;
  ariaDescription: string;
}

function setAsyncWrapperStatus(wrapperEl: HTMLElement, status: SubagentDisplayStatus): void {
  const classes = ['pending', 'queued', 'running', 'waiting', 'awaiting', 'completed', 'failed', 'cancelled', 'error', 'orphaned', 'async', 'done'];
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
  const { info, displayStatus, initiallyExpanded, ariaDescription } = options;
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item' });
  setAsyncWrapperStatus(wrapperEl, displayStatus);
  wrapperEl.dataset.asyncSubagentId = info.id;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });
  headerEl.setAttribute('aria-expanded', initiallyExpanded ? 'true' : 'false');

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  applySubagentHeaderIcon(iconEl, info);

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentAgentName(info.id, info.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });
  updateSummaryText(summaryEl, info);

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status' });
  const statusPresentation = renderSubagentStatus(statusEl, info);
  headerEl.setAttribute(
    'aria-label',
    `${t('chat.activity.backgroundTask')}: ${ariaDescription} - ${statusPresentation.label} - ${t('chat.activity.expand')}`,
  );

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });

  return { wrapperEl, contentEl, headerEl, labelEl, summaryEl, statusEl };
}

function renderAsyncContentLikeSync(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
  renderContent?: SubagentRenderContentFn,
  beginDisclosureResize?: (header: HTMLElement) => void,
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
    renderOptions.beginDisclosureResize = beginDisclosureResize;
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
      text: getVisibleSubagentResult(subagent.result, t('chat.activity.sessionEnded')),
      renderContent,
      scrollContainerEl: contentEl,
      generation,
    });
    return;
  }

  const fallback = displayStatus === 'error'
    ? t('chat.activity.error')
    : t('chat.activity.done');
  const finalText = getVisibleSubagentResult(subagent.result, fallback);
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
  renderAsyncContentLikeSync(
    state.contentEl,
    state.info,
    state.contentStatus,
    state.renderContent,
    state.beginDisclosureResize,
  );
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
    contentStatus: 'running',
    contentRendered: false,
    contentDirty: true,
    renderContent: options.renderContent,
    beginDisclosureResize: options.beginDisclosureResize,
    info,
  };

  setupCollapsible(shell.wrapperEl, shell.headerEl, shell.contentEl, info, {
    initiallyExpanded: info.isExpanded,
    onBeforeToggle: () => options.beginDisclosureResize?.(shell.headerEl),
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
  state.info.activityStatus = asyncStatus === 'pending' ? 'queued' : 'running';
  state.info.agentId = agentId || state.info.agentId;

  setAsyncWrapperStatus(state.wrapperEl, asyncStatus === 'pending' ? 'queued' : asyncStatus);
  updateAsyncLabel(state);

  markAsyncContentDirty(state, 'running');
}

export function finalizeAsyncSubagent(
  state: AsyncSubagentState,
  result: string,
  isError: boolean
): void {
  state.info.asyncStatus = isError ? 'error' : 'completed';
  state.info.status = isError ? 'error' : 'completed';
  state.info.activityStatus = isError ? 'failed' : 'completed';
  state.info.result = result;
  state.info.completedAt ??= Date.now();

  setAsyncWrapperStatus(state.wrapperEl, isError ? 'failed' : 'completed');
  updateAsyncLabel(state);

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
  state.info.activityStatus = 'orphaned';
  state.info.result = t('chat.activity.sessionEnded');
  state.info.completedAt ??= Date.now();

  setAsyncWrapperStatus(state.wrapperEl, 'orphaned');
  updateAsyncLabel(state);

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
  beginDisclosureResize?: (header: HTMLElement) => void,
): HTMLElement {
  const displayStatus = getSubagentDisplayStatus(subagent);
  const shell = createAsyncSubagentShell(parentEl, {
    info: subagent,
    displayStatus,
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
    contentStatus,
    contentRendered: false,
    contentDirty: true,
    renderContent,
    beginDisclosureResize,
    info: { ...subagent, isExpanded: false },
  };

  setupCollapsible(shell.wrapperEl, shell.headerEl, shell.contentEl, renderState.info, {
    initiallyExpanded: renderState.info.isExpanded,
    onBeforeToggle: () => beginDisclosureResize?.(shell.headerEl),
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
