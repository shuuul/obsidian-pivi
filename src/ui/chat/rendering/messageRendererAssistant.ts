import { formatDurationMmSs } from '@pivi/pivi-agent-core/context/date';
import type { ChatMessage, ContentBlock, SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';

import {
  isAssistantToolStepBoundaryBlock,
  shouldToolCallStayInAssistantToolStepGroup,
} from './assistantContentSegmentBoundaries';
import { renderStoredAsyncSubagent } from './AsyncSubagentRenderer';
import type { RenderContentOptions } from './messageRendererTypes';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';
import {
  aggregateToolCallRuns,
} from './toolCallAggregation';
import { renderStoredToolCall } from './ToolCallRenderer';
import { appendStepToStreamingGroup, createToolStepGroup, renderStoredToolStepGroup, type ToolStepGroupState } from './ToolStepGroupRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface AssistantContentHost {
  renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions,
  ): Promise<void>;
}


interface AssistantBlockContext {
  host: AssistantContentHost;
  msg: ChatMessage;
  contentEl: HTMLElement;
  renderedToolIds: Set<string>;
}

function isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
  return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
}

export function shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
  if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
  if (toolCall.name === TOOL_WRITE_STDIN && isSilentWriteStdinTool(toolCall)) return false;
  if (toolCall.name === 'custom_tool_call_output') return false;

  const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(toolCall.name);
  if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

  return true;
}

function mapToolStatusToSubagentStatus(
  status: ToolCallInfo['status'],
): 'completed' | 'error' | 'running' {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'error':
    case 'blocked':
      return 'error';
    default:
      return 'running';
  }
}

function inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
  if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
  if (toolCall.status === 'running') return 'running';

  const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
  if (
    lowerResult.includes('not_ready')
    || lowerResult.includes('not ready')
    || lowerResult.includes('"status":"running"')
    || lowerResult.includes('"status":"pending"')
    || lowerResult.includes('"retrieval_status":"running"')
    || lowerResult.includes('"retrieval_status":"not_ready"')
  ) {
    return 'running';
  }

  return 'completed';
}

function taskInputString(input: Record<string, unknown> | undefined, key: string): string {
  if (!input) return '';
  const value = input[key];
  return typeof value === 'string' ? value : '';
}

function resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
  if (toolCall.subagent) {
    if (!modeHint || toolCall.subagent.mode === modeHint) {
      return toolCall.subagent;
    }
    return {
      ...toolCall.subagent,
      mode: modeHint,
    };
  }

  const description = taskInputString(toolCall.input, 'label')
    || taskInputString(toolCall.input, 'description')
    || 'Subagent task';
  const prompt = taskInputString(toolCall.input, 'message')
    || taskInputString(toolCall.input, 'prompt');
  const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

  if (mode !== 'async') {
    return {
      id: toolCall.id,
      description,
      prompt,
      status: mapToolStatusToSubagentStatus(toolCall.status),
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  const asyncStatus = inferAsyncStatusFromTaskTool(toolCall);
  return {
    id: toolCall.id,
    description,
    prompt,
    mode: 'async',
    status: asyncStatus,
    asyncStatus,
    toolCalls: [],
    isExpanded: false,
    result: toolCall.result,
  };
}

function renderTaskSubagent(
  host: AssistantContentHost,
  contentEl: HTMLElement,
  toolCall: ToolCallInfo,
  modeHint?: 'sync' | 'async',
): void {
  const subagentInfo = resolveTaskSubagent(toolCall, modeHint);
  const renderSubagentContent = (el: HTMLElement, markdown: string) => host.renderContent(el, markdown);
  if (subagentInfo.mode === 'async') {
    renderStoredAsyncSubagent(contentEl, subagentInfo, renderSubagentContent);
    return;
  }
  renderStoredSubagent(contentEl, subagentInfo, renderSubagentContent);
}

function renderProviderLifecycleSubagent(
  host: AssistantContentHost,
  contentEl: HTMLElement,
  spawnToolCall: ToolCallInfo,
  msg: ChatMessage,
): void {
  const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(spawnToolCall.name);
  if (!subagentLifecycleAdapter) {
    renderStoredToolCall(contentEl, spawnToolCall);
    return;
  }

  const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
    spawnToolCall,
    msg.toolCalls ?? [],
  );
  renderStoredSubagent(contentEl, subagentInfo, (el, markdown) => host.renderContent(el, markdown));
}

function renderToolCall(
  host: AssistantContentHost,
  contentEl: HTMLElement,
  toolCall: ToolCallInfo,
  msg?: ChatMessage,
): void {
  if (!shouldRenderToolCall(toolCall)) return;
  const subagentLifecycleAdapter = resolveSubagentLifecycleAdapter(toolCall.name);

  if (isWriteEditTool(toolCall.name)) {
    renderStoredWriteEdit(contentEl, toolCall);
  } else if (isSubagentToolName(toolCall.name)) {
    renderTaskSubagent(host, contentEl, toolCall);
  } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
    renderProviderLifecycleSubagent(host, contentEl, toolCall, msg);
  } else {
    renderStoredToolCall(contentEl, toolCall);
  }
}

function renderThinkingBlock(ctx: AssistantBlockContext, block: Extract<ContentBlock, { type: 'thinking' }>): void {
  if (!block.content || !block.content.trim()) {
    return;
  }
  renderStoredThinkingBlock(
    ctx.contentEl,
    block.content,
    block.durationSeconds,
    (el, md) => ctx.host.renderContent(el, md),
  );
}

function renderTextBlock(ctx: AssistantBlockContext, block: Extract<ContentBlock, { type: 'text' }>): void {
  if (!block.content || !block.content.trim()) {
    return;
  }
  const textEl = ctx.contentEl.createDiv({ cls: 'pivi-text-block' });
  void ctx.host.renderContent(textEl, block.content);
}

function renderContentBlocks(host: AssistantContentHost, msg: ChatMessage, contentEl: HTMLElement): Set<string> {
  const renderedToolIds = new Set<string>();
  const ctx: AssistantBlockContext = { host, msg, contentEl, renderedToolIds };

  let activeToolGroup: ToolStepGroupState | null = null;

  const renderToolStep = (toolCall: ToolCallInfo) => {
    if (activeToolGroup) {
      appendStepToStreamingGroup(activeToolGroup, toolCall);
    } else {
      activeToolGroup = createToolStepGroup(contentEl, [toolCall]);
    }
    renderedToolIds.add(toolCall.id);
  };

  const closeToolSegment = () => {
    activeToolGroup = null;
  };

  for (const block of msg.contentBlocks ?? []) {
    if (block.type === 'tool_use') {
      const toolCall = msg.toolCalls?.find((tc) => tc.id === block.toolId);
      if (!toolCall || !shouldRenderToolCall(toolCall)) continue;
      if (shouldToolCallStayInAssistantToolStepGroup(toolCall, msg)) {
        renderToolStep(toolCall);
      } else {
        closeToolSegment();
        renderToolCall(host, contentEl, toolCall, msg);
        renderedToolIds.add(toolCall.id);
      }
      continue;
    }

    if (isAssistantToolStepBoundaryBlock(block)) {
      closeToolSegment();
    }
    switch (block.type) {
      case 'thinking':
        renderThinkingBlock(ctx, block);
        break;
      case 'text':
        renderTextBlock(ctx, block);
        break;
      case 'context_compacted':
        renderContextCompactedBlock(ctx);
        break;
      case 'subagent':
        renderSubagentBlock(ctx, block);
        break;
    }
  }

  return renderedToolIds;
}

function renderContextCompactedBlock(ctx: AssistantBlockContext): void {
  const boundaryEl = ctx.contentEl.createDiv({ cls: 'pivi-compact-boundary' });
  boundaryEl.createSpan({ cls: 'pivi-compact-boundary-label', text: 'Session compacted' });
}

function renderSubagentBlock(ctx: AssistantBlockContext, block: Extract<ContentBlock, { type: 'subagent' }>): void {
  const taskToolCall = ctx.msg.toolCalls?.find(
    (tc) => tc.id === block.subagentId && isSubagentToolName(tc.name),
  );
  if (!taskToolCall) return;

  renderTaskSubagent(ctx.host, ctx.contentEl, taskToolCall, block.mode);
  ctx.renderedToolIds.add(taskToolCall.id);
}

function renderOrphanToolCalls(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
  renderedToolIds: Set<string>,
): void {
  if (!msg.toolCalls || msg.toolCalls.length === 0) return;

  const orphans = msg.toolCalls.filter((tc) => !renderedToolIds.has(tc.id));
  const runs = aggregateToolCallRuns(orphans, msg);
  for (const run of runs) {
    if (run.kind === 'group') {
      renderStoredToolStepGroup(contentEl, run.toolCalls);
      for (const tc of run.toolCalls) {
        renderedToolIds.add(tc.id);
      }
    } else {
      renderToolCall(host, contentEl, run.toolCall, msg);
      renderedToolIds.add(run.toolCall.id);
    }
  }
}

function renderLegacyAssistantText(host: AssistantContentHost, msg: ChatMessage, contentEl: HTMLElement): void {
  if (msg.content) {
    const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
    void host.renderContent(textEl, msg.content);
  }
  if (msg.toolCalls) {
    const runs = aggregateToolCallRuns(msg.toolCalls, msg);
    for (const run of runs) {
      if (run.kind === 'group') {
        renderStoredToolStepGroup(contentEl, run.toolCalls);
      } else {
        renderToolCall(host, contentEl, run.toolCall, msg);
      }
    }
  }
}

function renderDurationFooter(msg: ChatMessage, contentEl: HTMLElement): void {
  const hasCompactBoundary = msg.contentBlocks?.some((b) => b.type === 'context_compacted');
  if (!msg.durationSeconds || msg.durationSeconds <= 0 || hasCompactBoundary) {
    return;
  }
  const flavorWord = msg.durationFlavorWord || 'Baked';
  const footerEl = contentEl.createDiv({ cls: 'pivi-response-footer' });
  footerEl.createSpan({
    text: `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`,
    cls: 'pivi-baked-duration',
  });
}

export function updateAssistantToolOnlyClass(contentEl: HTMLElement): void {
  if (
    typeof contentEl.closest !== 'function'
    || typeof contentEl.find !== 'function'
    || typeof contentEl.findAll !== 'function'
  ) return;

  const msgEl = contentEl.closest('.pivi-message-assistant');
  if (!(msgEl instanceof HTMLElement)) return;

  const hasVisibleText = contentEl.findAll('.pivi-text-block')
    .some((el) => el.textContent?.trim());
  const hasToolOnlyContent = !!contentEl.find('.pivi-tool-call, .pivi-tool-step-group')
    && !hasVisibleText
    && !contentEl.find('.pivi-thinking-block')
    && !contentEl.find('.pivi-subagent-block')
    && !contentEl.find('.pivi-write-edit-block')
    && !contentEl.find('.pivi-response-footer')
    && !contentEl.find('.pivi-compact-boundary');

  msgEl.toggleClass('pivi-message-assistant-tool-only', hasToolOnlyContent);
}

export function renderAssistantContent(
  host: AssistantContentHost,
  msg: ChatMessage,
  contentEl: HTMLElement,
): void {
  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    const renderedToolIds = renderContentBlocks(host, msg, contentEl);
    renderOrphanToolCalls(host, msg, contentEl, renderedToolIds);
  } else {
    renderLegacyAssistantText(host, msg, contentEl);
  }

  renderDurationFooter(msg, contentEl);
  updateAssistantToolOnlyClass(contentEl);
}

export function messageHasVisibleAssistantContent(msg: ChatMessage): boolean {
  if (msg.content && msg.content.trim().length > 0) return true;
  if (msg.contentBlocks && msg.contentBlocks.length > 0) {
    for (const block of msg.contentBlocks) {
      if (block.type === 'thinking' && block.content.trim().length > 0) return true;
      if (block.type === 'text' && block.content.trim().length > 0) return true;
      if (block.type === 'context_compacted') return true;
      if (block.type === 'subagent') return true;
      if (block.type === 'tool_use') {
        const toolCall = msg.toolCalls?.find((tc) => tc.id === block.toolId);
        if (toolCall && shouldRenderToolCall(toolCall)) return true;
      }
    }
  }
  if (msg.toolCalls?.some((toolCall) => shouldRenderToolCall(toolCall))) return true;
  return false;
}
