import type { SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import { setIcon } from 'obsidian';

import { setupCollapsible } from './collapsible';
import { appendToolIcon } from './toolCallIcon';
import {
  getToolLabel,
  getToolName,
  getToolSummary,
  renderExpandedContent,
} from './ToolCallRenderer';
import {
  appendConstructionWorkingIcon,
  clearWorkingIcon,
} from './workingIcon';

export type SubagentRenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface SubagentToolView {
  wrapperEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  contentEl: HTMLElement;
}

export interface SubagentSection {
  wrapperEl: HTMLElement;
  bodyEl: HTMLElement;
}

export interface CreateSectionOptions {
  initiallyExpanded?: boolean;
  onToggle?: (isExpanded: boolean) => void;
}

export interface CreateSubagentBlockOptions {
  initiallyExpanded?: boolean;
  renderContent?: SubagentRenderContentFn;
  writerName?: string;
}

export type SubagentDisplayStatus = 'pending' | 'running' | 'completed' | 'error' | 'orphaned';

const MARKDOWN_RENDER_GENERATION_ATTR = 'piviMarkdownRenderGeneration';

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

export function nextMarkdownRenderGeneration(el: HTMLElement): string {
  const next = Number(el.dataset[MARKDOWN_RENDER_GENERATION_ATTR] ?? '0') + 1;
  const generation = String(next);
  el.dataset[MARKDOWN_RENDER_GENERATION_ATTR] = generation;
  return generation;
}

export function isCurrentMarkdownRenderGeneration(el: HTMLElement, generation: string): boolean {
  return el.dataset[MARKDOWN_RENDER_GENERATION_ATTR] === generation;
}

export function extractTaskDescription(input: Record<string, unknown>): string {
  return (input.label as string) || (input.description as string) || 'Subagent task';
}

export function extractTaskPrompt(input: Record<string, unknown>): string {
  return (input.message as string) || (input.prompt as string) || '';
}

export function truncateDescription(description: string, maxLength = 40): string {
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

export function formatSubagentAgentName(id: string, writerName?: string): string {
  return writerName || resolveWriterName(id);
}

export function formatSubagentTitle(id: string, description: string, writerName?: string): string {
  return `${formatSubagentAgentName(id, writerName)} [${truncateDescription(description)}]`;
}

export function getSubagentDisplayStatus(info: SubagentInfo): SubagentDisplayStatus {
  switch (info.asyncStatus) {
    case 'pending': return 'pending';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'orphaned': return 'orphaned';
    default:
      break;
  }

  switch (info.status) {
    case 'completed': return 'completed';
    case 'error': return 'error';
    default: return 'running';
  }
}

export function getSubagentStatusLabel(info: SubagentInfo): string {
  switch (getSubagentDisplayStatus(info)) {
    case 'pending':
    case 'running':
      return 'Working';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'orphaned': return 'Orphaned';
  }
}

export function applySubagentHeaderIcon(iconEl: HTMLElement, info: SubagentInfo): void {
  const displayStatus = getSubagentDisplayStatus(info);
  iconEl.removeClass('status-pending', 'status-running', 'status-completed', 'status-error', 'status-orphaned');
  iconEl.addClass(`status-${displayStatus}`);

  if (displayStatus === 'pending' || displayStatus === 'running') {
    appendConstructionWorkingIcon(iconEl);
    return;
  }

  clearWorkingIcon(iconEl);
  iconEl.empty();
  iconEl.createDiv({ cls: 'pivi-subagent-indicator-dot' });
}

export function renderSubagentStatus(statusEl: HTMLElement, info: SubagentInfo): void {
  const displayStatus = getSubagentDisplayStatus(info);
  const statusLabel = getSubagentStatusLabel(info);
  statusEl.className = 'pivi-subagent-status';
  statusEl.addClass(`status-${displayStatus}`);
  statusEl.empty();
  statusEl.setAttribute('aria-label', `Status: ${statusLabel}`);
  statusEl.setText(statusLabel);
}

export function createSection(
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

export function scrollSubagentContentToBottom(contentEl: HTMLElement): void {
  window.requestAnimationFrame(() => {
    contentEl.scrollTop = contentEl.scrollHeight;
  });
}

export function setPromptText(
  promptBodyEl: HTMLElement,
  prompt: string,
  renderContent?: SubagentRenderContentFn,
  scrollContainerEl?: HTMLElement,
): void {
  const generation = nextMarkdownRenderGeneration(promptBodyEl);
  promptBodyEl.empty();
  const textEl = promptBodyEl.createDiv({ cls: 'pivi-subagent-prompt-text' });
  const text = prompt || 'No prompt provided';
  if (renderContent) {
    void renderContent(textEl, text).then(() => {
      if (!isCurrentMarkdownRenderGeneration(promptBodyEl, generation)) {
        textEl.remove();
        return;
      }
      if (scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
    }).catch(() => {
      if (!isCurrentMarkdownRenderGeneration(promptBodyEl, generation)) return;
      textEl.setText(text);
      if (scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
    });
    return;
  }
  textEl.setText(text);
}


export function updateSummaryText(summaryEl: HTMLElement, info: SubagentInfo): void {
  summaryEl.setText(truncateDescription(info.description, 80));
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

export function updateSubagentToolView(view: SubagentToolView, toolCall: ToolCallInfo): void {
  view.wrapperEl.className = `pivi-subagent-tool-item pivi-subagent-tool-${toolCall.status}`;
  view.nameEl.setText(getToolName(toolCall.name, toolCall.input));
  view.summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
  setSubagentToolStatus(view, toolCall.status);
  renderSubagentToolContent(view.contentEl, toolCall);
}

export function createSubagentToolView(parentEl: HTMLElement, toolCall: ToolCallInfo): SubagentToolView {
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
