import { getObsidianToolsSettingsFromBag } from '@pivi/pivi-agent-core/foundation/settings';
import type { MountInlineEditSurfaceChromeOptions } from '@pivi/pivi-react/mount';
import type { App, Component } from 'obsidian';
import { MarkdownRenderer } from 'obsidian';

import type { PiviPluginHost } from '@/app/hostContracts';
import { getVaultPath, normalizePathForVault } from '@/app/hostPlatform';
import { t } from '@/app/i18n';

import type { InlineEditDiffReviewKind } from './types';

type PresentationPlatform = MountInlineEditSurfaceChromeOptions['platform'];

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

  return { root, errorEl };
}

export function getInlineEditActiveVaultFilePath(app: App): string | null {
  const activePath = app.workspace.getActiveFile?.()?.path ?? null;
  return normalizePathForVault(activePath, getVaultPath(app));
}

export function getInlineEditExternalContexts(host: PiviPluginHost): string[] {
  return getObsidianToolsSettingsFromBag(host.settings).externalReadDirectories;
}
