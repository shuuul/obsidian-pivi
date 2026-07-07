import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { getToolIcon } from '@pivi/pivi-agent-core/tools/toolIcons';
import { TOOL_TASK } from '@pivi/pivi-agent-core/tools/toolNames';
import { setIcon } from 'obsidian';

import { setupCollapsible } from './collapsible';
import { appendToolIcon } from './toolCallIcon';
import {
  getToolLabel,
  getToolName,
  getToolSummary,
  renderExpandedContent,
} from './ToolCallRenderer';

export type SubagentRenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

interface SubagentToolView {
  wrapperEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
}

interface SubagentSection {
  wrapperEl: HTMLElement;
  bodyEl: HTMLElement;
}

interface CreateSectionOptions {
  initiallyExpanded?: boolean;
  onToggle?: (isExpanded: boolean) => void;
}

interface CreateSubagentBlockOptions {
  initiallyExpanded?: boolean;
  renderContent?: SubagentRenderContentFn;
  writerName?: string;
}

export interface SubagentState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  labelEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  promptSectionEl: HTMLElement;
  promptBodyEl: HTMLElement;
  toolsContainerEl: HTMLElement;
  resultSectionEl: HTMLElement | null;
  resultBodyEl: HTMLElement | null;
  toolElements: Map<string, SubagentToolView>;
  renderContent?: SubagentRenderContentFn;
  info: SubagentInfo;
}

const SUBAGENT_TOOL_STATUS_ICONS: Partial<Record<ToolCallInfo['status'], string>> = {
  completed: 'check',
  error: 'x',
  blocked: 'shield-off',
};

const SUBAGENT_WRITER_NAMES = [
  'Austen',
  'Baldwin',
  'Borges',
  'Brontë',
  'Calvino',
  'Dostoevsky',
  'Eliot',
  'Homer',
  'Kafka',
  'Le Guin',
  'Morrison',
  'Murakami',
  'Neruda',
  'Sappho',
  'Tolstoy',
  'Woolf',
] as const;

function extractTaskDescription(input: Record<string, unknown>): string {
  return (input.label as string) || (input.description as string) || 'Subagent task';
}

function extractTaskPrompt(input: Record<string, unknown>): string {
  return (input.message as string) || (input.prompt as string) || '';
}

function truncateDescription(description: string, maxLength = 40): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + '...';
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function resolveWriterName(id: string): string {
  return SUBAGENT_WRITER_NAMES[hashString(id) % SUBAGENT_WRITER_NAMES.length];
}

export function formatSubagentTitle(id: string, description: string, writerName?: string): string {
  return `${writerName || resolveWriterName(id)} [${truncateDescription(description)}]`;
}

function createSection(
  parentEl: HTMLElement,
  title: string,
  bodyClass?: string,
  options: CreateSectionOptions = {},
): SubagentSection {
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-section' });

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-section-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const titleEl = headerEl.createDiv({ cls: 'pivi-subagent-section-title' });
  titleEl.setText(title);

  const bodyEl = wrapperEl.createDiv({ cls: 'pivi-subagent-section-body' });
  if (bodyClass) bodyEl.addClass(bodyClass);

  const state = { isExpanded: options.initiallyExpanded ?? true };
  setupCollapsible(wrapperEl, headerEl, bodyEl, state, {
    initiallyExpanded: state.isExpanded,
    onToggle: options.onToggle,
    baseAriaLabel: title,
  });

  return { wrapperEl, bodyEl };
}

function scrollSubagentContentToBottom(contentEl: HTMLElement): void {
  window.requestAnimationFrame(() => {
    contentEl.scrollTop = contentEl.scrollHeight;
  });
}

function setPromptText(
  promptBodyEl: HTMLElement,
  prompt: string,
  renderContent?: SubagentRenderContentFn,
  scrollContainerEl?: HTMLElement,
): void {
  promptBodyEl.empty();
  const textEl = promptBodyEl.createDiv({ cls: 'pivi-subagent-prompt-text' });
  const text = prompt || 'No prompt provided';
  if (renderContent) {
    void renderContent(textEl, text).finally(() => {
      if (scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
    });
    return;
  }
  textEl.setText(text);
}

function summarizeToolCall(toolCall: ToolCallInfo): string {
  const status = toolCall.status === 'running'
    ? 'Running'
    : toolCall.status === 'completed'
      ? 'Done'
      : 'Error';
  return `${status}: ${getToolName(toolCall.name, toolCall.input)} ${getToolSummary(toolCall.name, toolCall.input)}`.trim();
}

function summarizeSubagent(info: SubagentInfo): string {
  const latestToolCall = info.toolCalls.at(-1);
  if (latestToolCall) {
    return summarizeToolCall(latestToolCall);
  }
  if (info.status === 'completed') return 'Completed';
  if (info.status === 'error') return info.result?.trim() ? `Error: ${info.result.trim()}` : 'Error';
  if (info.asyncStatus === 'pending') return 'Initializing';
  return 'Waiting for subagent activity';
}

function updateSummaryText(summaryEl: HTMLElement, info: SubagentInfo): void {
  summaryEl.setText(summarizeSubagent(info));
}

function updateSyncHeaderAria(state: SubagentState): void {
  state.headerEl.setAttribute(
    'aria-label',
    `Subagent task: ${truncateDescription(state.info.description)} - Status: ${state.info.status} - click to expand`
  );
  state.statusEl.setAttribute('aria-label', `Status: ${state.info.status}`);
  updateSummaryText(state.summaryEl, state.info);
}

function renderSubagentToolContent(contentEl: HTMLElement, toolCall: ToolCallInfo): void {
  contentEl.empty();

  if (!toolCall.result && toolCall.status === 'running') {
    const emptyEl = contentEl.createDiv({ cls: 'pivi-subagent-tool-empty' });
    emptyEl.setText('Running...');
    return;
  }

  renderExpandedContent(contentEl, toolCall.name, toolCall.result, toolCall.input);
}

function setSubagentToolStatus(view: SubagentToolView, status: ToolCallInfo['status']): void {
  view.statusEl.className = 'pivi-subagent-tool-status';
  view.statusEl.addClass(`status-${status}`);
  view.statusEl.empty();
  view.statusEl.setAttribute('aria-label', `Status: ${status}`);

  const statusIcon = SUBAGENT_TOOL_STATUS_ICONS[status];
  if (statusIcon) {
    setIcon(view.statusEl, statusIcon);
  }
}

function updateSubagentToolView(view: SubagentToolView, toolCall: ToolCallInfo): void {
  view.wrapperEl.className = `pivi-subagent-tool-item pivi-subagent-tool-${toolCall.status}`;
  view.nameEl.setText(getToolName(toolCall.name, toolCall.input));
  view.summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
  setSubagentToolStatus(view, toolCall.status);
  renderSubagentToolContent(view.contentEl, toolCall);
}

function createSubagentToolView(parentEl: HTMLElement, toolCall: ToolCallInfo): SubagentToolView {
  const wrapperEl = parentEl.createDiv({
    cls: `pivi-subagent-tool-item pivi-subagent-tool-${toolCall.status}`,
  });
  wrapperEl.dataset.toolId = toolCall.id;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-tool-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createDiv({ cls: 'pivi-tool-icon pivi-tool-icon--small pivi-subagent-tool-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  appendToolIcon(iconEl, toolCall.name);

  const nameEl = headerEl.createDiv({ cls: 'pivi-subagent-tool-name' });
  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-tool-summary' });
  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-tool-status' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-tool-content' });

  const collapseState = { isExpanded: toolCall.isExpanded ?? true };
  setupCollapsible(wrapperEl, headerEl, contentEl, collapseState, {
    initiallyExpanded: collapseState.isExpanded,
    onToggle: (expanded) => {
      toolCall.isExpanded = expanded;
    },
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input),
  });

  const view: SubagentToolView = {
    wrapperEl,
    nameEl,
    summaryEl,
    statusEl,
    contentEl,
  };
  updateSubagentToolView(view, toolCall);

  return view;
}

function ensureResultSection(state: SubagentState): SubagentSection {
  if (state.resultSectionEl && state.resultBodyEl) {
    return { wrapperEl: state.resultSectionEl, bodyEl: state.resultBodyEl };
  }

  const section = createSection(state.contentEl, 'Result', 'pivi-subagent-result-body');
  section.wrapperEl.addClass('pivi-subagent-section-result');
  state.resultSectionEl = section.wrapperEl;
  state.resultBodyEl = section.bodyEl;
  return section;
}

export function setSubagentResultText(state: SubagentState, text: string): void {
  const section = ensureResultSection(state);
  section.bodyEl.empty();
  const resultEl = section.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });
  if (state.renderContent) {
    void state.renderContent(resultEl, text).finally(() => scrollSubagentContentToBottom(state.contentEl));
  } else {
    resultEl.setText(text);
    scrollSubagentContentToBottom(state.contentEl);
  }
}

function hydrateSyncSubagentStateFromStored(state: SubagentState, subagent: SubagentInfo): void {
  state.info.description = subagent.description;
  state.info.writerName = subagent.writerName;
  state.info.prompt = subagent.prompt;
  state.info.mode = subagent.mode;
  state.info.status = subagent.status;
  state.info.result = subagent.result;

  state.labelEl.setText(formatSubagentTitle(state.info.id, subagent.description, state.info.writerName));
  setPromptText(state.promptBodyEl, subagent.prompt || '', state.renderContent, state.contentEl);

  for (const originalToolCall of subagent.toolCalls) {
    const toolCall: ToolCallInfo = {
      ...originalToolCall,
      input: { ...originalToolCall.input },
    };
    addSubagentToolCall(state, toolCall);
    if (toolCall.status !== 'running' || toolCall.result) {
      updateSubagentToolResult(state, toolCall.id, toolCall);
    }
  }

  if (subagent.status === 'completed' || subagent.status === 'error') {
    const fallback = subagent.status === 'error' ? 'ERROR' : 'DONE';
    finalizeSubagentBlock(state, subagent.result || fallback, subagent.status === 'error');
  } else {
    state.statusEl.className = 'pivi-subagent-status status-running';
    state.statusEl.empty();
    updateSyncHeaderAria(state);
  }
}

export function createSubagentBlock(
  parentEl: HTMLElement,
  taskToolId: string,
  taskInput: Record<string, unknown>,
  options: CreateSubagentBlockOptions = {},
): SubagentState {
  const description = extractTaskDescription(taskInput);
  const prompt = extractTaskPrompt(taskInput);

  const info: SubagentInfo = {
    id: taskToolId,
    writerName: options.writerName,
    description,
    prompt,
    status: 'running',
    toolCalls: [],
    isExpanded: options.initiallyExpanded ?? false,
  };

  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list' });
  wrapperEl.dataset.subagentId = taskToolId;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });
  headerEl.setAttribute('tabindex', '0');
  headerEl.setAttribute('role', 'button');

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolIcon(TOOL_TASK));

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentTitle(taskToolId, description, info.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status status-running' });
  statusEl.setAttribute('aria-label', 'Status: running');

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });

  const promptSection = createSection(contentEl, 'Prompt', 'pivi-subagent-prompt-body');
  promptSection.wrapperEl.addClass('pivi-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, prompt, options.renderContent, contentEl);

  const toolsContainerEl = contentEl.createDiv({ cls: 'pivi-subagent-tools' });

  setupCollapsible(wrapperEl, headerEl, contentEl, info, {
    initiallyExpanded: info.isExpanded,
    onToggle: (expanded) => {
      if (expanded) scrollSubagentContentToBottom(contentEl);
    },
  });

  const state: SubagentState = {
    wrapperEl,
    contentEl,
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    promptSectionEl: promptSection.wrapperEl,
    promptBodyEl: promptSection.bodyEl,
    toolsContainerEl,
    resultSectionEl: null,
    resultBodyEl: null,
    toolElements: new Map<string, SubagentToolView>(),
    renderContent: options.renderContent,
    info,
  };

  updateSyncHeaderAria(state);
  return state;
}

export function addSubagentToolCall(
  state: SubagentState,
  toolCall: ToolCallInfo
): void {
  const existingIndex = state.info.toolCalls.findIndex(tc => tc.id === toolCall.id);
  if (existingIndex >= 0) {
    const existingToolCall = state.info.toolCalls[existingIndex];
    const mergedToolCall: ToolCallInfo = {
      ...existingToolCall,
      ...toolCall,
      input: {
        ...existingToolCall.input,
        ...toolCall.input,
      },
      result: toolCall.result ?? existingToolCall.result,
      isExpanded: toolCall.isExpanded ?? existingToolCall.isExpanded,
    };

    state.info.toolCalls[existingIndex] = mergedToolCall;

    const existingView = state.toolElements.get(toolCall.id);
    if (existingView) {
      updateSubagentToolView(existingView, mergedToolCall);
    }

    updateSyncHeaderAria(state);
    return;
  }

  state.info.toolCalls.push(toolCall);

  const toolView = createSubagentToolView(state.toolsContainerEl, toolCall);
  state.toolElements.set(toolCall.id, toolView);

  updateSyncHeaderAria(state);
}

export function updateSubagentToolResult(
  state: SubagentState,
  toolId: string,
  toolCall: ToolCallInfo
): void {
  const idx = state.info.toolCalls.findIndex(tc => tc.id === toolId);
  if (idx !== -1) {
    state.info.toolCalls[idx] = toolCall;
  }

  const toolView = state.toolElements.get(toolId);
  if (!toolView) {
    return;
  }

  updateSubagentToolView(toolView, toolCall);
}

export function finalizeSubagentBlock(
  state: SubagentState,
  result: string,
  isError: boolean
): void {
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  state.labelEl.setText(formatSubagentTitle(state.info.id, state.info.description, state.info.writerName));

  state.statusEl.className = 'pivi-subagent-status';
  state.statusEl.addClass(`status-${state.info.status}`);
  state.statusEl.empty();
  if (state.info.status === 'completed') {
    setIcon(state.statusEl, 'check');
    state.wrapperEl.removeClass('error');
    state.wrapperEl.addClass('done');
  } else {
    setIcon(state.statusEl, 'x');
    state.wrapperEl.removeClass('done');
    state.wrapperEl.addClass('error');
  }

  const finalText = result?.trim() ? result : (isError ? 'ERROR' : 'DONE');
  setSubagentResultText(state, finalText);

  updateSyncHeaderAria(state);
}

export function renderStoredSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  renderContent?: SubagentRenderContentFn,
): HTMLElement {
  const state = createSubagentBlock(parentEl, subagent.id, {
    description: subagent.description,
    prompt: subagent.prompt,
  }, {
    initiallyExpanded: false,
    renderContent,
  });

  hydrateSyncSubagentStateFromStored(state, subagent);
  return state.wrapperEl;
}

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

function getAsyncDisplayStatus(asyncStatus: string | undefined): 'running' | 'completed' | 'error' | 'orphaned' {
  switch (asyncStatus) {
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'orphaned': return 'orphaned';
    default: return 'running';
  }
}

function getAsyncStatusAriaLabel(asyncStatus: string | undefined): string {
  switch (asyncStatus) {
    case 'pending': return 'Initializing';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
    default: return 'Running in background';
  }
}

function updateAsyncLabel(state: AsyncSubagentState): void {
  state.labelEl.setText(formatSubagentTitle(state.info.id, state.info.description, state.info.writerName));

  const statusLabel = getAsyncStatusAriaLabel(state.info.asyncStatus);
  state.headerEl.setAttribute(
    'aria-label',
    `Background task: ${truncateDescription(state.info.description)} - ${statusLabel} - click to expand`
  );
}

function renderAsyncContentLikeSync(
  contentEl: HTMLElement,
  subagent: SubagentInfo,
  displayStatus: 'running' | 'completed' | 'error' | 'orphaned',
  renderContent?: SubagentRenderContentFn,
): void {
  contentEl.empty();

  const promptSection = createSection(contentEl, 'Prompt', 'pivi-subagent-prompt-body');
  promptSection.wrapperEl.addClass('pivi-subagent-section-prompt');
  setPromptText(promptSection.bodyEl, subagent.prompt || '', renderContent, contentEl);

  const toolsContainerEl = contentEl.createDiv({ cls: 'pivi-subagent-tools' });
  for (const originalToolCall of subagent.toolCalls) {
    const toolCall: ToolCallInfo = {
      ...originalToolCall,
      input: { ...originalToolCall.input },
    };
    createSubagentToolView(toolsContainerEl, toolCall);
  }

  if (displayStatus === 'running' && !subagent.result?.trim()) {
    return;
  }

  const resultSection = createSection(contentEl, 'Result', 'pivi-subagent-result-body');
  resultSection.wrapperEl.addClass('pivi-subagent-section-result');
  const resultEl = resultSection.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });

  if (displayStatus === 'orphaned') {
    const text = subagent.result || 'Session ended before task completed';
    if (renderContent) {
      void renderContent(resultEl, text).finally(() => scrollSubagentContentToBottom(contentEl));
    } else {
      resultEl.setText(text);
      scrollSubagentContentToBottom(contentEl);
    }
    return;
  }

  const fallback = displayStatus === 'error' ? 'ERROR' : 'DONE';
  const finalText = subagent.result?.trim() ? subagent.result : fallback;
  if (renderContent) {
    void renderContent(resultEl, finalText).finally(() => scrollSubagentContentToBottom(contentEl));
  } else {
    resultEl.setText(finalText);
    scrollSubagentContentToBottom(contentEl);
  }
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

  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list' });
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

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status status-running' });
  statusEl.setAttribute('aria-label', 'Status: running');

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

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.addClass('is-hidden');

  state.statusEl.className = 'pivi-subagent-status';
  state.statusEl.addClass(`status-${isError ? 'error' : 'completed'}`);
  state.statusEl.empty();
  if (isError) {
    setIcon(state.statusEl, 'x');
  } else {
    setIcon(state.statusEl, 'check');
  }

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

  updateSummaryText(state.summaryEl, state.info);
  state.progressEl.addClass('is-hidden');

  state.statusEl.className = 'pivi-subagent-status status-error';
  state.statusEl.empty();
  setIcon(state.statusEl, 'alert-circle');

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
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list' });
  const displayStatus = getAsyncDisplayStatus(subagent.asyncStatus);
  setAsyncWrapperStatus(wrapperEl, displayStatus);

  if (displayStatus === 'completed') {
    wrapperEl.addClass('done');
  } else if (displayStatus === 'error' || displayStatus === 'orphaned') {
    wrapperEl.addClass('error');
  }
  wrapperEl.dataset.asyncSubagentId = subagent.id;

  const statusAriaLabel = getAsyncStatusAriaLabel(subagent.asyncStatus);

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

  let statusIconClass: string;
  switch (displayStatus) {
    case 'error':
    case 'orphaned':
      statusIconClass = 'status-error';
      break;
    case 'completed':
      statusIconClass = 'status-completed';
      break;
    default:
      statusIconClass = 'status-running';
  }
  const statusEl = headerEl.createDiv({ cls: `pivi-subagent-status ${statusIconClass}` });
  statusEl.setAttribute('aria-label', `Status: ${statusAriaLabel}`);

  const progressEl = wrapperEl.createDiv({
    cls: displayStatus === 'running'
      ? 'pivi-subagent-progress'
      : 'pivi-subagent-progress is-hidden',
  });
  progressEl.createDiv({ cls: 'pivi-subagent-progress-bar' });

  switch (displayStatus) {
    case 'completed':
      setIcon(statusEl, 'check');
      break;
    case 'error':
      setIcon(statusEl, 'x');
      break;
    case 'orphaned':
      setIcon(statusEl, 'alert-circle');
      break;
  }

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });
  renderAsyncContentLikeSync(contentEl, subagent, displayStatus, renderContent);

  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, headerEl, contentEl, state, {
    initiallyExpanded: state.isExpanded,
    onToggle: (expanded) => {
      if (expanded) scrollSubagentContentToBottom(contentEl);
    },
  });

  return wrapperEl;
}
