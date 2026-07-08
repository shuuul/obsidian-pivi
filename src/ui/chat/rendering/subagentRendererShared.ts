import type { SubagentInfo } from '@pivi/pivi-agent-core/foundation';

import { setupCollapsible } from './collapsible';
import {
  appendConstructionWorkingIcon,
  clearWorkingIcon,
} from './workingIcon';

export type SubagentRenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

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

interface UpdateSubagentHeaderDisplayOptions {
  headerEl: HTMLElement;
  labelEl?: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  info: SubagentInfo;
  ariaLabelPrefix: string;
  includeStatusLabelPrefix?: boolean;
}

interface RenderSubagentMarkdownOptions {
  generationEl: HTMLElement;
  targetEl: HTMLElement;
  text: string;
  renderContent?: SubagentRenderContentFn;
  scrollContainerEl?: HTMLElement;
  generation?: string;
  scrollPlainText?: boolean;
}

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

export function updateSubagentHeaderDisplay(options: UpdateSubagentHeaderDisplayOptions): void {
  const {
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    info,
    ariaLabelPrefix,
    includeStatusLabelPrefix = false,
  } = options;
  labelEl?.setText(formatSubagentAgentName(info.id, info.writerName));
  const statusLabel = getSubagentStatusLabel(info);
  const iconEl = headerEl.querySelector<HTMLElement>('.pivi-subagent-icon');
  if (iconEl) applySubagentHeaderIcon(iconEl, info);
  const statusPhrase = includeStatusLabelPrefix ? `Status: ${statusLabel}` : statusLabel;
  headerEl.setAttribute(
    'aria-label',
    `${ariaLabelPrefix}: ${truncateDescription(info.description)} - ${statusPhrase} - click to expand`,
  );
  renderSubagentStatus(statusEl, info);
  updateSummaryText(summaryEl, info);
}

export function renderSubagentMarkdownWithFallback(options: RenderSubagentMarkdownOptions): void {
  const {
    generationEl,
    targetEl,
    text,
    renderContent,
    scrollContainerEl,
    generation = nextMarkdownRenderGeneration(generationEl),
    scrollPlainText = true,
  } = options;

  if (!renderContent) {
    targetEl.setText(text);
    if (scrollPlainText && scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
    return;
  }

  void renderContent(targetEl, text).then(() => {
    if (!isCurrentMarkdownRenderGeneration(generationEl, generation)) {
      targetEl.remove();
      return;
    }
    if (scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
  }).catch(() => {
    if (!isCurrentMarkdownRenderGeneration(generationEl, generation)) return;
    targetEl.setText(text);
    if (scrollContainerEl) scrollSubagentContentToBottom(scrollContainerEl);
  });
}

export function createSection(
  parentEl: HTMLElement,
  title: string,
  bodyClass?: string,
  options: CreateSectionOptions = {},
): SubagentSection {
  const wrapperEl = parentEl.createDiv({ cls: 'pivi-subagent-section' });

  const headerEl = wrapperEl.createDiv({ cls: 'pivi-subagent-section-header' });

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
  renderSubagentMarkdownWithFallback({
    generationEl: promptBodyEl,
    targetEl: textEl,
    text,
    renderContent,
    scrollContainerEl,
    generation,
    scrollPlainText: false,
  });
}


export function updateSummaryText(summaryEl: HTMLElement, info: SubagentInfo): void {
  summaryEl.setText(truncateDescription(info.description, 80));
}
