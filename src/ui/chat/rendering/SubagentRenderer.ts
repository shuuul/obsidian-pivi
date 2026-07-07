import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
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
  isCurrentMarkdownRenderGeneration,
  nextMarkdownRenderGeneration,
  renderSubagentStatus,
  scrollSubagentContentToBottom,
  setPromptText,
  type SubagentRenderContentFn,
  type SubagentToolView,
  truncateDescription,
  updateSubagentToolView,
  updateSummaryText,
} from './subagentRendererShared';

export type { SubagentRenderContentFn } from './subagentRendererShared';

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

function updateSyncHeaderAria(state: SubagentState): void {
  state.headerEl.setAttribute(
    'aria-label',
    `Subagent task: ${truncateDescription(state.info.description)} - Status: ${state.info.status} - click to expand`
  );
  renderSubagentStatus(state.statusEl, state.info);
  updateSummaryText(state.summaryEl, state.info);
}

function ensureResultSection(state: SubagentState) {
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
  const generation = nextMarkdownRenderGeneration(section.bodyEl);
  section.bodyEl.empty();
  const resultEl = section.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });
  if (state.renderContent) {
    void state.renderContent(resultEl, text).then(() => {
      if (!isCurrentMarkdownRenderGeneration(section.bodyEl, generation)) {
        resultEl.remove();
        return;
      }
      scrollSubagentContentToBottom(state.contentEl);
    }).catch(() => {
      if (!isCurrentMarkdownRenderGeneration(section.bodyEl, generation)) return;
      resultEl.setText(text);
      scrollSubagentContentToBottom(state.contentEl);
    });
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

  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item' });
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

  if (state.info.status === 'completed') {
    state.wrapperEl.removeClass('error');
    state.wrapperEl.addClass('done');
  } else {
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
