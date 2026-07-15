import {
  type ActivityStatus,
  resolveSubagentActivityStatus,
  type SubagentInfo,
} from '@pivi/pivi-agent-core/foundation';

import { t } from '@/app/i18n';

import { resolveSubagentWriterName } from '../subagentProfiles';
import {
  getActivityStatusLabel,
  renderActivityStatusContents,
} from './activityStatusPresentation';
import { setupCollapsible } from './collapsible';
import type { RenderContentOptions } from './messageRendererTypes';
import {
  appendSubagentCompletedIcon,
  appendSubagentRunningIcon,
  clearSubagentAnimatedIcon,
} from './subagentAnimatedIcon';

export type SubagentRenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions,
) => Promise<void>;

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

export type SubagentDisplayStatus = ActivityStatus;

const MARKDOWN_RENDER_GENERATION_ATTR = 'piviMarkdownRenderGeneration';

interface UpdateSubagentHeaderDisplayOptions {
  headerEl: HTMLElement;
  labelEl?: HTMLElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
  info: SubagentInfo;
  ariaLabelPrefix: string;
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
  return (input.label as string) || (input.description as string) || t('chat.activity.subagentTask');
}

export function extractTaskPrompt(input: Record<string, unknown>): string {
  return (input.message as string) || (input.prompt as string) || '';
}

export function truncateDescription(description: string, maxLength = 40): string {
  if (description.length <= maxLength) return description;
  return description.substring(0, maxLength) + '...';
}

export function formatSubagentAgentName(id: string, writerName?: string): string {
  return writerName || resolveSubagentWriterName(id);
}

export function formatSubagentTitle(id: string, description: string, writerName?: string): string {
  return `${formatSubagentAgentName(id, writerName)} [${truncateDescription(description)}]`;
}

export function getSubagentDisplayStatus(info: SubagentInfo): SubagentDisplayStatus {
  return resolveSubagentActivityStatus(info);
}

export function getSubagentStatusLabel(info: SubagentInfo): string {
  return getActivityStatusLabel(getSubagentDisplayStatus(info));
}

export function applySubagentHeaderIcon(iconEl: HTMLElement, info: SubagentInfo): void {
  const displayStatus = getSubagentDisplayStatus(info);
  for (const statusClass of ['status-queued', 'status-running', 'status-waiting', 'status-completed', 'status-failed', 'status-cancelled', 'status-orphaned']) {
    iconEl.removeClass(statusClass);
  }
  iconEl.addClass(`status-${displayStatus}`);

  if (displayStatus === 'queued' || displayStatus === 'running') {
    appendSubagentRunningIcon(iconEl, info.id, formatSubagentAgentName(info.id, info.writerName));
    return;
  }

  if (displayStatus === 'completed') {
    appendSubagentCompletedIcon(iconEl, info.id, formatSubagentAgentName(info.id, info.writerName));
    return;
  }

  clearSubagentAnimatedIcon(iconEl);
  iconEl.empty();
  iconEl.createDiv({ cls: 'pivi-subagent-indicator-dot' });
}

export function renderSubagentStatus(statusEl: HTMLElement, info: SubagentInfo): void {
  const displayStatus = getSubagentDisplayStatus(info);
  statusEl.className = 'pivi-subagent-status pivi-activity-status';
  statusEl.addClass(`status-${displayStatus}`);
  renderActivityStatusContents(statusEl, displayStatus);
}

export function updateSubagentHeaderDisplay(options: UpdateSubagentHeaderDisplayOptions): void {
  const {
    headerEl,
    labelEl,
    summaryEl,
    statusEl,
    info,
    ariaLabelPrefix,
  } = options;
  labelEl?.setText(formatSubagentAgentName(info.id, info.writerName));
  const statusLabel = getSubagentStatusLabel(info);
  const iconEl = headerEl.querySelector<HTMLElement>('.pivi-subagent-icon');
  if (iconEl) applySubagentHeaderIcon(iconEl, info);
  const statusPhrase = statusLabel;
  headerEl.setAttribute(
    'aria-label',
    `${ariaLabelPrefix}: ${truncateDescription(info.description)} - ${statusPhrase} - ${t('chat.activity.expand')}`,
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
  const ownerWindow = contentEl.ownerDocument?.defaultView;
  ownerWindow?.requestAnimationFrame(() => {
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
  const text = prompt || t('chat.activity.noPrompt');
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
