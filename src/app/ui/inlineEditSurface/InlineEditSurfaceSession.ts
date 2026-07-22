import type { EditorView } from '@codemirror/view';
import type { MentionBadgeParseContext } from '@pivi/pivi-agent-core/context/mentions';
import {
  type InlineEditSurfaceChromeHandle,
  mountInlineEditSurfaceChrome,
  type MountInlineEditSurfaceChromeOptions,
} from '@pivi/pivi-react/mount';
import type { ComposerOptionSnapshot } from '@pivi/pivi-react/store';
import { Component, type Editor } from 'obsidian';

import type { PiviPluginHost, PiviPluginWorkspace } from '@/app/hostContracts';
import { getVaultPath, normalizePathForVault } from '@/app/hostPlatform';
import { t } from '@/app/i18n';
import { applyInlineEditAcceptance } from '@/app/ui/inlineEditHelpers';
import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
import type {
  DropdownMcpServerProvider,
  DropdownMcpToolProvider,
} from '@/ui/shared/components/slashCommandDropdownData';
import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';
import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';
import { MentionInput } from '@/ui/shared/mention/MentionInput';
import { getVaultFileAliases as getVaultFileAliasesFromMetadata } from '@/ui/shared/mention/obsidianMentionVault';
import { VaultMentionDataProvider } from '@/ui/shared/mention/VaultMentionDataProvider';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';
import { buildExternalContextDisplayEntries } from '@/ui/shared/utils/externalContext';
import { registerFileLinkHandler } from '@/ui/shared/utils/fileLink';

import { extractInlineEditContextFiles } from './extractInlineEditContextFiles';
import {
  getInlineEditDiffReviewAcceptRange,
  hideInlineEditDiffReviewDecoration,
  InlineEditDiffReviewWidget,
  showInlineEditDiffReviewDecoration,
} from './inlineEditDiffReviewField';
import {
  buildInlineEditDiffReviewDom,
  getInlineEditActiveVaultFilePath,
  getInlineEditExternalContexts,
  renderInlineEditPlatformIcon,
  renderInlineEditReplyMarkdown,
} from './inlineEditSurfaceDomHelpers';
import {
  createInlineEditSurfaceRoot,
  getInlineEditSurfaceTargetRange,
  hideInlineEditSurfaceDecoration,
  InlineEditSurfaceWidget,
  showInlineEditSurfaceDecoration,
} from './inlineEditSurfaceField';
import { resolveEditorFromEditorView } from './resolveInlineEditEditor';
import type {
  InlineEditDiffReviewKind,
  InlineEditSurfaceComposerState,
  InlineEditSurfaceSendPayload,
  InlineEditSurfaceSessionContract,
  InlineEditSurfaceSessionId,
  InlineEditSurfaceSessionOptions,
} from './types';

let nextInlineEditSurfaceSessionId = 1;

interface ComposerDefaults {
  model: string;
  thinkingLevel: string;
  modelOptions: ComposerOptionSnapshot[];
  thinkingOptions: ComposerOptionSnapshot[];
  adaptiveReasoning: boolean;
  defaultReasoningValue: string;
}

export interface InlineEditSurfaceSessionDeps {
  plugin: PiviPluginHost;
  i18n: MountInlineEditSurfaceChromeOptions['i18n'];
  platform: MountInlineEditSurfaceChromeOptions['platform'];
  composerDefaults: ComposerDefaults;
  getWorkspace: () => Promise<PiviPluginWorkspace>;
}

export class InlineEditSurfaceSession implements InlineEditSurfaceSessionContract {
  readonly id = `inline-edit-${nextInlineEditSurfaceSessionId++}` as InlineEditSurfaceSessionId;
  onSend?: (payload: InlineEditSurfaceSendPayload) => void;
  onReject?: () => void;
  onDiffReject?: () => void;
  onAccept?: () => void;
  onStop?: () => void;

  private snapshot: EditorSelectionSnapshot | null = null;
  private boundEditorView: EditorView | null = null;
  private boundEditor: Editor | null = null;
  private diffErrorEl: HTMLElement | null = null;
  private rootEl: HTMLElement | null = null;
  private widget: InlineEditSurfaceWidget | null = null;
  private diffWidget: InlineEditDiffReviewWidget | null = null;
  private diffRootEl: HTMLElement | null = null;
  private diffReviewKind: InlineEditDiffReviewKind | null = null;
  private diffReviewNewText = '';
  private phase: 'input' | 'diff-review' = 'input';
  private mentionInput: MentionInput | null = null;
  private mentionDropdown: MentionDropdownController | null = null;
  private slashDropdown: SlashCommandDropdown | null = null;
  private chrome: InlineEditSurfaceChromeHandle | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private sendIconEl: HTMLElement | null = null;
  private replyEl: HTMLElement | null = null;
  private replyContentHostEl: HTMLElement | null = null;
  private replyContentEl: HTMLElement | null = null;
  private replyCopyIconEl: HTMLElement | null = null;
  private replyText = '';
  private replyRenderGeneration = 0;
  private replyRenderComponent: Component | null = null;
  private copyFeedbackTimeout: number | null = null;
  private vaultDataProvider: VaultMentionDataProvider | null = null;
  private workspace: PiviPluginWorkspace | null = null;
  private readonly markdownComponent = new Component();
  private streaming = false;
  private destroyed = false;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private keydownWindow: Window | null = null;

  private model: string;
  private thinkingLevel: string;
  private readonly modelOptions: ComposerOptionSnapshot[];
  private thinkingOptions: ComposerOptionSnapshot[];
  private adaptiveReasoning: boolean;
  private defaultReasoningValue: string;

  constructor(
    private readonly deps: InlineEditSurfaceSessionDeps,
    options: InlineEditSurfaceSessionOptions = {},
  ) {
    this.onSend = options.onSend;
    this.onReject = options.onReject;
    this.onDiffReject = options.onDiffReject;
    this.onAccept = options.onAccept;
    this.onStop = options.onStop;
    this.model = deps.composerDefaults.model;
    this.thinkingLevel = deps.composerDefaults.thinkingLevel;
    this.modelOptions = deps.composerDefaults.modelOptions.map(option => ({ ...option }));
    this.thinkingOptions = deps.composerDefaults.thinkingOptions.map(option => ({ ...option }));
    this.adaptiveReasoning = deps.composerDefaults.adaptiveReasoning;
    this.defaultReasoningValue = deps.composerDefaults.defaultReasoningValue;
  }

  show(snapshot: EditorSelectionSnapshot): void {
    if (this.destroyed) {
      return;
    }

    this.snapshot = snapshot;
    this.boundEditorView = snapshot.editorView;
    this.boundEditor = snapshot.editor ?? resolveEditorFromEditorView(snapshot.editorView);
    this.markdownComponent.load();
    const ownerDocument = snapshot.editorView.dom.ownerDocument;
    this.rootEl = createInlineEditSurfaceRoot(ownerDocument);
    this.buildDom(this.rootEl);
    this.widget = new InlineEditSurfaceWidget(this.rootEl);

    showInlineEditSurfaceDecoration(
      snapshot.editorView,
      this.id,
      snapshot.from,
      snapshot.to,
      this.widget,
    );

    void this.initializeMentionStack(snapshot.editorView.dom.ownerDocument.defaultView!).catch(() => {
      if (!this.destroyed) {
        this.showError(t('editor.inlineEdit.chatUnavailable'));
      }
    });
    this.mentionInput?.focus();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    if (this.snapshot) {
      hideInlineEditSurfaceDecoration(this.snapshot.editorView, this.id);
      hideInlineEditDiffReviewDecoration(this.snapshot.editorView, this.id);
    }

    this.removeKeydownHandler();
    this.clearCopyFeedback();
    void this.chrome?.dispose();
    this.chrome = null;
    this.mentionDropdown?.destroy();
    this.slashDropdown?.destroy();
    this.mentionInput?.destroy();
    this.vaultDataProvider = null;
    this.replyRenderGeneration += 1;
    this.replyRenderComponent?.unload();
    this.replyRenderComponent = null;
    this.markdownComponent.unload();
    this.rootEl = null;
    this.widget = null;
    this.diffWidget = null;
    this.diffRootEl = null;
    this.diffReviewKind = null;
    this.diffReviewNewText = '';
    this.phase = 'input';
    this.boundEditorView = null;
    this.boundEditor = null;
    this.diffErrorEl = null;
    this.replyContentHostEl = null;
    this.replyContentEl = null;
    this.replyCopyIconEl = null;
    this.replyText = '';
    this.snapshot = null;
  }

  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.rootEl?.toggleClass('pivi-inline-edit-surface--waiting', streaming);
    this.updateInputDisabled();
    this.renderChrome();
    this.updateSendButton();
  }

  setReplyText(text: string): void {
    if (!this.replyEl || !this.replyContentEl || !this.snapshot) {
      return;
    }

    this.replyText = text;
    if (text.trim().length > 0) {
      this.rootEl?.removeClass('pivi-inline-edit-surface--waiting');
    }
    void this.renderReplyMarkdown(text);
    this.replyEl.toggleClass('pivi-inline-edit-surface-reply--visible', text.trim().length > 0);
  }

  showError(message: string): void {
    if (this.phase === 'diff-review' && this.diffErrorEl) {
      this.diffErrorEl.textContent = message;
      this.diffErrorEl.toggleClass('pivi-inline-edit-diff-review-error--visible', message.length > 0);
      return;
    }
    this.setReplyText(message);
  }

  showDiffReview(oldText: string, newText: string, kind: InlineEditDiffReviewKind): void {
    const snapshot = this.snapshot;
    if (!snapshot || this.destroyed) {
      return;
    }

    const target = getInlineEditSurfaceTargetRange(snapshot.editorView, this.id);
    if (!target) {
      this.showError(t('editor.inlineEdit.selectionUnavailable'));
      return;
    }
    this.phase = 'diff-review';
    this.diffReviewKind = kind;
    this.diffReviewNewText = newText;
    this.setStreaming(false);
    hideInlineEditSurfaceDecoration(snapshot.editorView, this.id);

    const ownerDocument = snapshot.editorView.dom.ownerDocument;
    const diffDom = buildInlineEditDiffReviewDom({
      ownerDocument,
      app: this.deps.plugin.app,
      markdownComponent: this.markdownComponent,
      platform: this.deps.platform,
      oldText,
      newText,
      kind,
      onAccept: () => this.handleDiffAccept(),
      onReject: () => this.handleDiffReject(),
    });
    this.diffRootEl = diffDom.root;
    this.diffErrorEl = diffDom.errorEl;
    this.diffWidget = new InlineEditDiffReviewWidget(this.diffRootEl);
    showInlineEditDiffReviewDecoration(snapshot.editorView, this.id, {
      from: target.from,
      to: target.to,
      kind,
      widget: this.diffWidget,
    });
  }

  getComposerState(): InlineEditSurfaceComposerState {
    return {
      model: this.model,
      thinkingLevel: this.thinkingLevel,
    };
  }

  setPrompt(text: string): void {
    if (!this.mentionInput) {
      return;
    }
    this.mentionInput.value = text;
    this.updateSendButton();
  }

  private buildDom(root: HTMLElement): void {
    const band = root.createDiv({ cls: 'pivi-inline-edit-surface-band' });
    const gutter = band.createDiv({ cls: 'pivi-inline-edit-surface-gutter' });
    const closeButton = gutter.createEl('button', {
      cls: 'pivi-inline-edit-surface-close',
      type: 'button',
      attr: { 'aria-label': t('editor.inlineEdit.closeAria') },
    });
    renderInlineEditPlatformIcon(this.deps.platform, closeButton, 'x');
    closeButton.addEventListener('click', () => this.handleReject());

    const body = band.createDiv({ cls: 'pivi-inline-edit-surface-body' });
    const inputRow = body.createDiv({ cls: 'pivi-inline-edit-surface-input-row' });
    const inputHost = inputRow.createDiv({ cls: 'pivi-inline-edit-surface-input-host' });

    const tail = body.createDiv({ cls: 'pivi-inline-edit-surface-tail' });
    const chromeEl = tail.createDiv({ cls: 'pivi-inline-edit-surface-chrome' });
    this.sendButton = tail.createEl('button', {
      cls: 'pivi-inline-edit-surface-send',
      type: 'button',
      attr: { 'aria-label': t('editor.inlineEdit.send') },
    });
    this.sendIconEl = this.sendButton.createSpan({ cls: 'pivi-inline-edit-surface-send-icon' });
    renderInlineEditPlatformIcon(this.deps.platform, this.sendIconEl, 'send');
    this.sendButton.addEventListener('click', () => this.handleSendButtonClick());

    this.replyEl = root.createDiv({
      cls: 'pivi-inline-edit-surface-reply pivi-message-assistant',
      attr: { 'aria-live': 'polite' },
    });
    this.replyContentHostEl = this.replyEl.createDiv({ cls: 'pivi-message-content' });
    this.replyContentEl = this.replyContentHostEl.createDiv({
      cls: 'pivi-inline-edit-surface-reply-content pivi-text-block pivi-markdown-rendered',
    });
    registerFileLinkHandler(this.deps.plugin.app, this.replyEl, this.markdownComponent);
    const replyActions = this.replyEl.createDiv({
      cls: 'pivi-inline-edit-surface-reply-actions pivi-message-actions pivi-assistant-msg-actions',
    });
    const copyButton = replyActions.createEl('button', {
      cls: 'pivi-inline-edit-surface-copy pivi-message-action-btn pivi-message-copy-btn pivi-assistant-msg-copy-btn',
      type: 'button',
      attr: { 'aria-label': t('chat.messageActions.copyAgentResponseAriaLabel') },
    });
    this.replyCopyIconEl = copyButton.createSpan({ cls: 'pivi-inline-edit-surface-copy-icon' });
    renderInlineEditPlatformIcon(this.deps.platform, this.replyCopyIconEl, 'copy');
    copyButton.addEventListener('click', () => void this.copyReplyMarkdown(copyButton));

    this.chrome = mountInlineEditSurfaceChrome({
      container: chromeEl,
      i18n: this.deps.i18n,
      platform: this.deps.platform,
      props: this.buildChromeProps(),
    });

    const app = this.deps.plugin.app;
    this.mentionInput = new MentionInput(inputHost, {
      app,
      className: 'pivi-inline-edit-surface-input',
      placeholder: t('editor.inlineEdit.placeholder'),
      getMentionContext: () => this.buildMentionContext(),
    });
    this.mentionInput.el.setAttribute('dir', 'auto');
    this.mentionInput.el.setAttribute('aria-label', t('editor.inlineEdit.promptAria'));
    this.mentionInput.addEventListener('input', () => {
      this.mentionDropdown?.handleInputChange();
      this.updateSendButton();
    });

    this.updateSendButton();
    this.updateInputDisabled();
  }

  private async renderReplyMarkdown(text: string): Promise<void> {
    const contentHost = this.replyContentHostEl;
    const template = this.replyContentEl;
    if (!contentHost || !template || this.destroyed) return;
    const generation = ++this.replyRenderGeneration;
    const { component, contentEl } = await renderInlineEditReplyMarkdown(
      this.deps.plugin.app, template, text,
    );
    if (this.destroyed || generation !== this.replyRenderGeneration || this.replyContentHostEl !== contentHost) {
      component.unload();
      return;
    }

    this.replyRenderComponent?.unload();
    this.replyRenderComponent = component;
    contentHost.replaceChildren(contentEl);
    this.replyContentEl = contentEl;
  }

  private handleDiffAccept(): void {
    if (this.destroyed || this.phase !== 'diff-review' || !this.snapshot || !this.diffReviewKind) {
      return;
    }

    const editor = this.boundEditor;
    const editorView = this.boundEditorView;
    if (!editor || !editorView) {
      this.showError(t('editor.inlineEdit.chatUnavailable'));
      return;
    }

    const acceptRange = getInlineEditDiffReviewAcceptRange(editorView, this.id);
    if (!acceptRange) {
      this.showError(t('editor.inlineEdit.selectionUnavailable'));
      return;
    }

    applyInlineEditAcceptance(
      editor,
      acceptRange.from,
      acceptRange.to,
      this.diffReviewNewText,
    );
    this.destroy();
    this.onAccept?.();
  }

  private handleDiffReject(): void {
    if (this.destroyed || this.phase !== 'diff-review') {
      return;
    }
    this.destroy();
    this.onDiffReject?.();
  }

  private async initializeMentionStack(ownerWindow: Window): Promise<void> {
    if (!this.mentionInput || !this.rootEl || this.destroyed) {
      return;
    }

    const workspace = await this.deps.getWorkspace();
    if (this.destroyed || !this.mentionInput || !this.rootEl) {
      return;
    }
    this.workspace = workspace;

    const app = this.deps.plugin.app;
    // CM block widgets participate in the editor's stacking context. Mount popup
    // selectors in the owner document so preceding editor lines cannot paint over them.
    const dropdownHost = this.rootEl.ownerDocument.body;

    this.vaultDataProvider = new VaultMentionDataProvider(app);
    this.vaultDataProvider.initializeInBackground();

    const mcpServerProvider: DropdownMcpServerProvider = {
      getServers: () => workspace.mcpServerManager.getServers(),
    };
    const mcpMentionProvider = {
      getServers: () => workspace.mcpServerManager.getServers(),
      getContextSavingServers: () => workspace.mcpServerManager.getContextSavingServers(),
    };
    const mcpToolProvider: DropdownMcpToolProvider = {
      listTools: (serverName) => workspace.mcpToolProvider.listTools(serverName),
    };

    this.mentionDropdown = new MentionDropdownController(
      dropdownHost,
      this.mentionInput,
      {
        onAttachFile: () => undefined,
        getMentionedMcpServers: () => new Set(),
        setMentionedMcpServers: () => false,
        addMentionedMcpServer: () => undefined,
        getExternalContexts: () => getInlineEditExternalContexts(this.deps.plugin),
        getCachedVaultFolders: () => this.vaultDataProvider?.getCachedVaultFolders() ?? [],
        getCachedVaultFiles: () => this.vaultDataProvider?.getCachedVaultFiles() ?? [],
        getVaultFileAliases: (file) => getVaultFileAliasesFromMetadata(app, file),
        getActiveVaultFilePath: () => getInlineEditActiveVaultFilePath(app),
        normalizePathForVault: (rawPath) => normalizePathForVault(rawPath, getVaultPath(app)),
      },
      { fixed: true },
    );
    this.mentionDropdown.setMcpManager(mcpMentionProvider);
    this.mentionDropdown.setAgentService(null);
    this.mentionDropdown.handleInputChange();

    this.slashDropdown = new SlashCommandDropdown(
      dropdownHost,
      this.mentionInput,
      { onSelect: () => undefined },
      {
        hiddenCommands: new Set(),
        catalogConfig: workspace.slashCommandCatalog.getDropdownConfig(),
        getCatalogEntries: () => workspace.slashCommandCatalog.listDropdownEntries({
          includeBuiltIns: true,
        }),
        getMcpManager: () => mcpServerProvider,
        getMcpToolProvider: () => mcpToolProvider,
        getSkills: () => workspace.skillProvider.listSkills(),
        fixed: true,
      },
    );

    this.keydownHandler = (event: KeyboardEvent): void => {
      if (!this.mentionInput || this.mentionInput.el.ownerDocument.activeElement !== this.mentionInput.el) {
        return;
      }
      if (this.slashDropdown?.handleKeydown(event)) {
        return;
      }
      if (this.mentionDropdown?.handleKeydown(event)) {
        return;
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && this.canSend()) {
        event.preventDefault();
        this.handleSend();
      }
    };
    this.keydownWindow = ownerWindow;
    this.keydownWindow.addEventListener('keydown', this.keydownHandler, { capture: true });
  }

  private removeKeydownHandler(): void {
    if (!this.keydownHandler || !this.keydownWindow) {
      return;
    }
    this.keydownWindow.removeEventListener('keydown', this.keydownHandler, { capture: true });
    this.keydownHandler = null;
    this.keydownWindow = null;
  }

  private buildChromeProps() {
    return {
      adaptiveReasoning: this.adaptiveReasoning,
      defaultReasoningValue: this.defaultReasoningValue,
      disabled: this.streaming,
      model: this.model,
      modelOptions: this.modelOptions,
      onModelChange: (value: string) => {
        const uiFacades = this.deps.plugin.getUiFacades();
        const settings = uiFacades.getSettingsSnapshot(this.deps.plugin.settings);
        this.model = value;
        this.thinkingOptions = uiFacades.chatUIConfig
          .getReasoningOptions(value, settings)
          .map(option => ({ ...option }));
        this.adaptiveReasoning = uiFacades.chatUIConfig.isAdaptiveReasoningModel(value, settings);
        this.defaultReasoningValue = uiFacades.chatUIConfig.getDefaultReasoningValue(value, settings);
        this.renderChrome();
      },
      onThinkingChange: (value: string) => {
        this.thinkingLevel = value;
        this.renderChrome();
      },
      thinkingLevel: this.thinkingLevel,
      thinkingOptions: this.thinkingOptions,
    };
  }

  private renderChrome(): void {
    this.chrome?.update(this.buildChromeProps());
  }

  private buildMentionContext(): MentionBadgeParseContext {
    const app = this.deps.plugin.app;
    const plugin = this.deps.plugin;
    const workspace = this.workspace;
    return {
      vault: createMentionVaultLookup(app),
      mcpServerNames: new Set(
        workspace?.mcpServerManager.getServers().map(server => server.name) ?? [],
      ),
      skillCommandNames: new Set(
        workspace?.skillProvider.listSkills().map(skill => skill.name) ?? [],
      ),
      externalContextEntries: buildExternalContextDisplayEntries(
        getInlineEditExternalContexts(plugin),
      ),
    };
  }

  private canSend(): boolean {
    return !this.streaming && (this.mentionInput?.value.trim().length ?? 0) > 0;
  }

  private updateSendButton(): void {
    if (!this.sendButton || !this.sendIconEl) {
      return;
    }
    this.sendButton.toggleClass('pivi-inline-edit-surface-send--stop', this.streaming);
    this.sendButton.setAttribute(
      'aria-label',
      this.streaming ? t('editor.inlineEdit.stop') : t('editor.inlineEdit.send'),
    );
    if (this.streaming) {
      this.sendButton.disabled = false;
      renderInlineEditPlatformIcon(this.deps.platform, this.sendIconEl, 'square');
      return;
    }
    this.sendButton.disabled = !this.canSend();
    renderInlineEditPlatformIcon(this.deps.platform, this.sendIconEl, 'send');
  }

  private updateInputDisabled(): void {
    if (!this.mentionInput) {
      return;
    }
    this.mentionInput.el.setAttribute('contenteditable', this.streaming ? 'false' : 'true');
    this.mentionInput.el.toggleClass('pivi-inline-edit-surface-input--streaming', this.streaming);
  }

  private async copyReplyMarkdown(button: HTMLButtonElement): Promise<void> {
    const ownerWindow = button.ownerDocument.defaultView;
    const clipboard = ownerWindow?.navigator.clipboard;
    if (!ownerWindow || !clipboard?.writeText || !this.replyText) return;
    await clipboard.writeText(this.replyText);
    if (!this.replyCopyIconEl) return;
    this.clearCopyFeedback();
    button.addClass('copied');
    renderInlineEditPlatformIcon(this.deps.platform, this.replyCopyIconEl, 'check');
    this.copyFeedbackTimeout = ownerWindow.setTimeout(() => {
      button.removeClass('copied');
      if (this.replyCopyIconEl) {
        renderInlineEditPlatformIcon(this.deps.platform, this.replyCopyIconEl, 'copy');
      }
      this.copyFeedbackTimeout = null;
    }, 1_500);
  }

  private clearCopyFeedback(): void {
    if (this.copyFeedbackTimeout === null) {
      return;
    }
    const ownerWindow = this.rootEl?.ownerDocument.defaultView;
    ownerWindow?.clearTimeout(this.copyFeedbackTimeout);
    this.copyFeedbackTimeout = null;
  }

  private handleSendButtonClick(): void {
    if (this.streaming) {
      this.onStop?.();
      return;
    }
    this.handleSend();
  }

  private handleSend(): void {
    if (!this.canSend() || !this.mentionInput) {
      return;
    }
    const prompt = this.mentionInput.value.trim();
    if (!prompt) {
      return;
    }
    const contextFiles = extractInlineEditContextFiles(prompt, this.buildMentionContext());
    this.onSend?.({
      prompt,
      contextFiles,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
    });
  }

  private handleReject(): void {
    this.onReject?.();
  }
}
