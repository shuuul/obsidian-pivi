import { getObsidianToolsSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import type { MountInlineEditSurfaceChromeOptions } from '@pivi/pivi-react/mount';
import type { App } from 'obsidian';
import { type Component, MarkdownRenderer } from 'obsidian';

import type { PiviPluginHost } from '@/app/hostContracts';
import { getVaultPath, normalizePathForVault } from '@/app/hostPlatform';
import { t } from '@/app/i18n';
import { createStreamingMarkdownContentAdapter } from '@/app/ui/createStreamingMarkdownContentAdapter';
import { renderMarkdownContent } from '@/ui/chat/rendering/messageRendererMarkdown';

import type { InlineEditDiffReviewKind } from './types';

type PresentationPlatform = MountInlineEditSurfaceChromeOptions['platform'];

function createInlineEditWaitingTimer(progressEl: HTMLElement): {
  start: () => void;
  stop: () => void;
} {
  const ownerWindow = progressEl.ownerDocument.defaultView;
  let startedAt: number | null = null;
  let timer: number | null = null;

  const update = (): void => {
    if (!ownerWindow || startedAt === null) return;
    const elapsedSeconds = Math.max(0, ownerWindow.performance.now() - startedAt) / 1_000;
    progressEl.textContent = `* ${elapsedSeconds.toFixed(1)}s`;
  };

  return {
    start: () => {
      if (!ownerWindow || timer !== null) return;
      startedAt = ownerWindow.performance.now();
      progressEl.addClass('pivi-inline-edit-surface-progress--visible');
      update();
      timer = ownerWindow.setInterval(update, 100);
    },
    stop: () => {
      update();
      if (timer !== null) ownerWindow?.clearInterval(timer);
      timer = null;
      startedAt = null;
    },
  };
}

/** Mounts first-output latency chrome, freezing the elapsed result when the running light stops. */
export function mountInlineEditWaitingIndicator(root: HTMLElement, parent: HTMLElement): {
  setWaiting: (waiting: boolean) => void;
  moveTo: (nextParent: HTMLElement) => void;
} {
  const progressEl = parent.createSpan({
    cls: 'pivi-inline-edit-surface-progress pivi-response-meta',
    attr: { role: 'timer', 'aria-live': 'off' },
  });
  const timer = createInlineEditWaitingTimer(progressEl);
  return {
    setWaiting: (waiting) => {
      root.toggleClass('pivi-inline-edit-surface--waiting', waiting);
      if (waiting) timer.start();
      else timer.stop();
    },
    moveTo: nextParent => nextParent.prepend(progressEl),
  };
}

/** Mounts the same sealed-prefix Markdown island used by Sidebar assistant text. */
export function mountInlineEditReplyMarkdown(
  app: App,
  parent: Component,
  container: HTMLElement,
  blockId: string,
): {
  update: (content: string, phase: 'streaming' | 'terminal') => void;
  dispose: () => void;
} {
  const ownerWindow = container.ownerDocument.defaultView;
  const adapter = createStreamingMarkdownContentAdapter(
    parent,
    (target, markdown, options) => renderMarkdownContent(
      { app, component: parent }, target, markdown, options,
    ),
  );
  if (!ownerWindow) return { update: () => undefined, dispose: () => undefined };
  const context = {
    generation: blockId,
    ownerDocument: container.ownerDocument,
    ownerWindow,
  };
  const dispose = adapter.mount(
    container,
    { blockId, content: '', phase: 'streaming' },
    context,
  );
  return {
    update: (content, phase) => adapter.update?.(container, { blockId, content, phase }, context),
    dispose: () => dispose?.(),
  };
}

/** Mounts a host icon into an inline-edit control surface. */
export function renderInlineEditPlatformIcon(
  platform: PresentationPlatform,
  container: HTMLElement,
  name: string,
): void {
  container.empty();
  const iconHost = container.createSpan({ cls: 'pivi-inline-edit-surface-icon' });
  platform.renderIcon(iconHost, name);
}

/** Creates a diff-review action button with icon, label, and shortcut hint. */
export function createInlineEditDiffReviewButton(
  platform: PresentationPlatform,
  parent: HTMLElement,
  className: string,
  label: string,
  shortcut: string,
  iconName: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = parent.createEl('button', {
    cls: className,
    type: 'button',
    attr: { 'aria-label': label },
  });
  const iconEl = button.createSpan({ cls: 'pivi-inline-edit-diff-review-btn-icon' });
  renderInlineEditPlatformIcon(platform, iconEl, iconName);
  button.createSpan({ cls: 'pivi-inline-edit-diff-review-btn-label', text: label });
  button.createSpan({ cls: 'pivi-inline-edit-diff-review-shortcut', text: shortcut });
  button.addEventListener('click', onClick);
  return button;
}

interface BuildInlineEditDiffReviewDomParams {
  ownerDocument: Document;
  app: App;
  markdownComponent: Component;
  platform: PresentationPlatform;
  oldText: string;
  newText: string;
  kind: InlineEditDiffReviewKind;
  onAccept: () => void;
  onReject: () => void;
}

interface InlineEditDiffReviewDom {
  root: HTMLElement;
  errorEl: HTMLElement;
  actionsEl: HTMLElement;
}

/** Builds the diff-review widget root and action controls. */
export function buildInlineEditDiffReviewDom(
  params: BuildInlineEditDiffReviewDomParams,
): InlineEditDiffReviewDom {
  const doc = params.ownerDocument as Document & {
    win: { createDiv: (args?: { cls?: string; text?: string }) => HTMLElement };
  };
  const root = doc.win.createDiv({ cls: 'pivi-inline-edit-diff-review' });
  root.createDiv({
    cls: 'pivi-inline-edit-diff-review-title',
    text: t('editor.inlineEdit.diffReviewTitle'),
  });
  root.createDiv({
    cls: 'pivi-inline-edit-diff-review-hint',
    text: t('editor.inlineEdit.diffReviewHint'),
  });
  const errorEl = root.createDiv({ cls: 'pivi-inline-edit-diff-review-error' });

  const sourcePath = params.app.workspace.getActiveFile()?.path ?? '';

  if (params.kind === 'replacement') {
    const deletionSection = root.createDiv({ cls: 'pivi-inline-edit-diff-review-section' });
    deletionSection.createDiv({
      cls: 'pivi-inline-edit-diff-review-section-label',
      text: t('editor.inlineEdit.diffReviewDeletion'),
    });
    const deletionEl = deletionSection.createDiv({
      cls: 'pivi-inline-edit-diff-review-deletion markdown-rendered',
    });
    void MarkdownRenderer.render(
      params.app,
      params.oldText,
      deletionEl,
      sourcePath,
      params.markdownComponent,
    );
  }

  const insertionSection = root.createDiv({ cls: 'pivi-inline-edit-diff-review-section' });
  insertionSection.createDiv({
    cls: 'pivi-inline-edit-diff-review-section-label',
    text: t('editor.inlineEdit.diffReviewInsertion'),
  });
  const insertionEl = insertionSection.createDiv({
    cls: 'pivi-inline-edit-diff-review-insertion markdown-rendered',
  });
  void MarkdownRenderer.render(
    params.app,
    params.newText,
    insertionEl,
    sourcePath,
    params.markdownComponent,
  );

  const actions = root.createDiv({ cls: 'pivi-inline-edit-diff-review-actions' });
  createInlineEditDiffReviewButton(
    params.platform,
    actions,
    'pivi-inline-edit-diff-review-accept',
    t('editor.inlineEdit.accept'),
    t('editor.inlineEdit.acceptHint'),
    'check',
    params.onAccept,
  );
  createInlineEditDiffReviewButton(
    params.platform,
    actions,
    'pivi-inline-edit-diff-review-reject',
    t('editor.inlineEdit.reject'),
    t('editor.inlineEdit.rejectHint'),
    'x',
    params.onReject,
  );

  return { root, errorEl, actionsEl: actions };
}

export function getInlineEditActiveVaultFilePath(app: App): string | null {
  const activePath = app.workspace.getActiveFile?.()?.path ?? null;
  return normalizePathForVault(activePath, getVaultPath(app));
}

export function getInlineEditExternalContexts(host: PiviPluginHost): string[] {
  return getObsidianToolsSettingsFromBag(host.settings).externalReadDirectories;
}
