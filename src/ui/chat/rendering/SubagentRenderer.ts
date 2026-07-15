import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isToolPresentationGroupable,
  shouldPresentToolCall,
} from '@pivi/pivi-agent-core/tools/toolPresentation';

import { t } from '@/app/i18n';

import { setupCollapsible } from './collapsible';
import {
  applySubagentHeaderIcon,
  createSection,
  type CreateSubagentBlockOptions,
  extractTaskDescription,
  extractTaskPrompt,
  formatSubagentAgentName,
  renderSubagentMarkdownWithFallback,
  scrollSubagentContentToBottom,
  setPromptText,
  type SubagentRenderContentFn,
  updateSubagentHeaderDisplay,
} from './subagentRendererShared';
import {
  renderStoredToolCall,
  type ToolContentRenderOptions,
  tryUpdateToolInStepGroup,
  updateToolCallElement,
} from './ToolCallRenderer';
import {
  appendStepToStreamingGroup,
  createToolStepGroup,
  type ToolStepGroupState,
} from './ToolStepGroupRenderer';

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
  toolElements: Map<string, HTMLElement>;
  toolStepGroup: ToolStepGroupState | null;
  renderContent?: SubagentRenderContentFn;
  info: SubagentInfo;
  sourceToolCalls: readonly ToolCallInfo[];
  renderedResult: string | null;
}

function getToolRenderOptions(state: SubagentState): ToolContentRenderOptions {
  if (!state.renderContent) return {};
  return {
    renderMarkdown: (container, markdown, sourcePath) => (
      state.renderContent?.(container, markdown, { sourcePath }) ?? Promise.resolve()
    ),
  };
}

function updateSyncHeaderAria(state: SubagentState): void {
  updateSubagentHeaderDisplay({
    headerEl: state.headerEl,
    summaryEl: state.summaryEl,
    statusEl: state.statusEl,
    info: state.info,
    ariaLabelPrefix: t('chat.activity.subagentTask'),
  });
}

function ensureResultSection(state: SubagentState) {
  if (state.resultSectionEl && state.resultBodyEl) {
    return { wrapperEl: state.resultSectionEl, bodyEl: state.resultBodyEl };
  }

  const section = createSection(state.contentEl, t('chat.activity.result'), 'pivi-subagent-result-body');
  section.wrapperEl.addClass('pivi-subagent-section-result');
  state.resultSectionEl = section.wrapperEl;
  state.resultBodyEl = section.bodyEl;
  return section;
}

export function setSubagentResultText(state: SubagentState, text: string): void {
  const section = ensureResultSection(state);
  section.bodyEl.empty();
  const resultEl = section.bodyEl.createDiv({ cls: 'pivi-subagent-result-output' });
  renderSubagentMarkdownWithFallback({
    generationEl: section.bodyEl,
    targetEl: resultEl,
    text,
    renderContent: state.renderContent,
    scrollContainerEl: state.contentEl,
  });
}

function hydrateSyncSubagentStateFromStored(state: SubagentState, subagent: SubagentInfo): void {
  state.info.description = subagent.description;
  state.info.writerName = subagent.writerName;
  state.info.prompt = subagent.prompt;
  state.info.mode = subagent.mode;
  state.info.status = subagent.status;
  state.info.result = subagent.result;

  state.labelEl.setText(formatSubagentAgentName(state.info.id, state.info.writerName));

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
  state.sourceToolCalls = subagent.toolCalls;

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

  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-list pivi-subagent-activity-item is-running' });
  wrapperEl.dataset.subagentId = taskToolId;

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-header' });

  const iconEl = headerEl.createDiv({ cls: 'pivi-subagent-icon' });
  iconEl.setAttribute('aria-hidden', 'true');
  applySubagentHeaderIcon(iconEl, info);

  const labelEl = headerEl.createDiv({ cls: 'pivi-subagent-label' });
  labelEl.setText(formatSubagentAgentName(taskToolId, info.writerName));

  const summaryEl = headerEl.createDiv({ cls: 'pivi-subagent-step-summary' });

  const statusEl = headerEl.createDiv({ cls: 'pivi-subagent-status status-running' });

  const contentEl = wrapperEl.createDiv({ cls: 'pivi-subagent-content' });

  const promptSection = createSection(contentEl, t('chat.activity.prompt'), 'pivi-subagent-prompt-body');
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
    toolElements: new Map<string, HTMLElement>(),
    toolStepGroup: null,
    renderContent: options.renderContent,
    info,
    sourceToolCalls: [],
    renderedResult: null,
  };

  updateSyncHeaderAria(state);
  return state;
}

export function addSubagentToolCall(
  state: SubagentState,
  toolCall: ToolCallInfo
): void {
  const existingIndex = state.info.toolCalls.findIndex(tc => tc.id === toolCall.id);
  const existingToolCall = existingIndex >= 0 ? state.info.toolCalls[existingIndex] : undefined;
  if (existingToolCall) {
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

    const existingElement = state.toolElements.get(toolCall.id);
    if (existingElement) {
      if (!tryUpdateToolInStepGroup(toolCall.id, mergedToolCall, state.toolElements)) {
        updateToolCallElement(existingElement, mergedToolCall, getToolRenderOptions(state));
      }
    } else {
      mountSubagentToolCall(state, mergedToolCall);
    }

    updateSyncHeaderAria(state);
    return;
  }

  state.info.toolCalls.push(toolCall);
  mountSubagentToolCall(state, toolCall);

  updateSyncHeaderAria(state);
}

function mountSubagentToolCall(state: SubagentState, toolCall: ToolCallInfo): void {
  if (!shouldPresentToolCall(toolCall.name, toolCall.input)) return;

  const groupable = isToolPresentationGroupable(
    toolCall.name,
    toolCall.input,
    !!toolCall.subagent,
  );
  if (groupable) {
    if (state.toolStepGroup) {
      appendStepToStreamingGroup(state.toolStepGroup, toolCall, state.toolElements);
    } else {
      state.toolStepGroup = createToolStepGroup(
        state.toolsContainerEl,
        [toolCall],
        state.toolElements,
        getToolRenderOptions(state),
      );
    }
    return;
  }

  const toolElement = renderStoredToolCall(
    state.toolsContainerEl,
    toolCall,
    getToolRenderOptions(state),
  );
  state.toolElements.set(toolCall.id, toolElement);
  state.toolStepGroup = null;
}

export function updateSubagentToolResult(
  state: SubagentState,
  toolId: string,
  toolCall: ToolCallInfo
): void {
  const idx = state.info.toolCalls.findIndex(tc => tc.id === toolId);
  const existingToolCall = idx >= 0 ? state.info.toolCalls[idx] : undefined;
  if (existingToolCall) {
    state.info.toolCalls[idx] = toolCall;
  }

  const toolElement = state.toolElements.get(toolId);
  if (!toolElement) {
    mountSubagentToolCall(state, toolCall);
    return;
  }
  if (!tryUpdateToolInStepGroup(toolId, toolCall, state.toolElements)) {
    updateToolCallElement(toolElement, toolCall, getToolRenderOptions(state));
  }
}

export function finalizeSubagentBlock(
  state: SubagentState,
  result: string,
  isError: boolean
): void {
  state.info.status = isError ? 'error' : 'completed';
  state.info.result = result;

  state.labelEl.setText(formatSubagentAgentName(state.info.id, state.info.writerName));

  if (state.info.status === 'completed') {
    state.wrapperEl.removeClass('error');
    state.wrapperEl.addClass('done');
  } else {
    state.wrapperEl.removeClass('done');
    state.wrapperEl.addClass('error');
  }

  const finalText = result?.trim() ? result : (isError ? t('chat.activity.error') : t('chat.activity.done'));
  if (state.renderedResult !== finalText) {
    setSubagentResultText(state, finalText);
    state.renderedResult = finalText;
  }

  updateSyncHeaderAria(state);
}

/** Update a mounted stored subagent without rebuilding its DOM or losing expansion state. */
export function updateStoredSubagent(state: SubagentState, subagent: SubagentInfo): void {
  const metadataChanged = state.info.description !== subagent.description
    || state.info.writerName !== subagent.writerName
    || state.info.prompt !== subagent.prompt;
  const previousStatus = state.info.status;

  state.info.description = subagent.description;
  state.info.writerName = subagent.writerName;
  state.info.prompt = subagent.prompt;
  state.info.mode = subagent.mode;
  state.info.asyncStatus = subagent.asyncStatus;
  state.info.agentId = subagent.agentId;
  state.info.result = subagent.result;

  if (metadataChanged) {
    state.labelEl.setText(formatSubagentAgentName(state.info.id, state.info.writerName));
    setPromptText(state.promptBodyEl, subagent.prompt || '', state.renderContent, state.contentEl);
    updateSyncHeaderAria(state);
  }

  if (state.sourceToolCalls !== subagent.toolCalls) {
    const previousSourceById = new Map(state.sourceToolCalls.map(toolCall => [toolCall.id, toolCall]));
    const existingById = new Map(state.info.toolCalls.map(toolCall => [toolCall.id, toolCall]));
    for (const nextToolCall of subagent.toolCalls) {
      const previousToolCall = existingById.get(nextToolCall.id);
      if (!previousToolCall) {
        addSubagentToolCall(state, { ...nextToolCall, input: { ...nextToolCall.input } });
      } else if (previousSourceById.get(nextToolCall.id) !== nextToolCall) {
        updateSubagentToolResult(state, nextToolCall.id, {
          ...nextToolCall,
          input: { ...nextToolCall.input },
        });
      }
    }
    state.sourceToolCalls = subagent.toolCalls;
  }

  state.info.status = subagent.status;
  if (subagent.status === 'completed' || subagent.status === 'error') {
    const fallback = subagent.status === 'error' ? 'ERROR' : 'DONE';
    finalizeSubagentBlock(state, subagent.result || fallback, subagent.status === 'error');
  } else if (previousStatus !== subagent.status) {
    updateSyncHeaderAria(state);
  }
}

export function mountStoredSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  renderContent?: SubagentRenderContentFn,
): SubagentState {
  const state = createSubagentBlock(parentEl, subagent.id, {
    description: subagent.description,
    prompt: subagent.prompt,
  }, {
    initiallyExpanded: subagent.isExpanded,
    renderContent,
    writerName: subagent.writerName,
  });

  hydrateSyncSubagentStateFromStored(state, subagent);
  return state;
}

export function renderStoredSubagent(
  parentEl: HTMLElement,
  subagent: SubagentInfo,
  renderContent?: SubagentRenderContentFn,
): HTMLElement {
  return mountStoredSubagent(parentEl, subagent, renderContent).wrapperEl;
}
