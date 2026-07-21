import type { EditorToolbarShortcut } from '@pivi/pivi-agent-core/foundation/settings';
import {
  mountSelectionToolbarSurface,
  type SelectionToolbarMountedSurface,
  type SelectionToolbarSurfaceProps,
} from '@pivi/pivi-react/mount';
import type { ComposerOptionSnapshot } from '@pivi/pivi-react/store';
import { MarkdownView, Notice } from 'obsidian';

import {
  getSelectionToolbarHost,
} from '@/app/editorSelectionToolbarRegistration';
import type { PiviPluginHost } from '@/app/hostContracts';
import { appI18n, t } from '@/app/i18n';
import { ensurePiviViewOpen } from '@/app/piviViewActivation';
import {
  applyInlineEditAcceptance,
  buildInlineEditTurnContent,
} from '@/app/ui/inlineEditHelpers';
import { obsidianPresentationPlatform } from '@/app/ui/obsidianPresentationPlatform';
import { getWorkspaceCommandFullId } from '@/app/workspaceCommandRegistry';
import type PiviPlugin from '@/main';
import { hideSelectionHighlight, showSelectionHighlight } from '@/ui/shared/components/SelectionHighlight';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

type SurfaceMode = 'toolbar' | 'inline-edit';

type InlineEditState = {
  prompt: string;
  model: string;
  thinkingLevel: string;
  status: 'idle' | 'streaming' | 'ready' | 'error';
  resultPreview?: string;
  errorMessage?: string;
};

type ComposerDefaults = {
  model: string;
  thinkingLevel: string;
  modelOptions: ComposerOptionSnapshot[];
  thinkingOptions: ComposerOptionSnapshot[];
  adaptiveReasoning: boolean;
  defaultReasoningValue: string;
};

function getEnabledShortcuts(settings: PiviPluginHost['settings']): EditorToolbarShortcut[] {
  return settings.editorSelectionToolbar.shortcuts.filter(shortcut => shortcut.enabled);
}

function getComposerDefaults(plugin: PiviPluginHost): ComposerDefaults {
  const uiFacades = plugin.getUiFacades();
  const settings = uiFacades.getSettingsSnapshot(plugin.settings);
  const chatConfig = uiFacades.chatUIConfig;
  const model = typeof settings.model === 'string' ? settings.model : plugin.settings.model;
  const thinkingLevel = typeof settings.thinkingLevel === 'string'
    ? settings.thinkingLevel
    : plugin.settings.thinkingLevel;

  return {
    model,
    thinkingLevel,
    modelOptions: chatConfig.getModelOptions(settings).map(option => ({ ...option })),
    thinkingOptions: chatConfig.getReasoningOptions(model, settings).map(option => ({ ...option })),
    adaptiveReasoning: chatConfig.isAdaptiveReasoningModel(model, settings),
    defaultReasoningValue: chatConfig.getDefaultReasoningValue(model, settings),
  };
}

function resolveActiveMarkdownView(plugin: PiviPluginHost): MarkdownView | null {
  return plugin.app.workspace.getActiveViewOfType(MarkdownView);
}

function executeObsidianCommand(plugin: PiviPluginHost, commandId: string): void {
  const commands = (plugin.app as PiviPluginHost['app'] & {
    commands?: { executeCommandById?: (id: string) => boolean };
  }).commands;
  if (typeof commands?.executeCommandById !== 'function') {
    new Notice(t('editor.selectionToolbar.commandUnavailable'));
    return;
  }
  const executed = commands.executeCommandById(commandId);
  if (!executed) {
    new Notice(t('editor.selectionToolbar.commandUnavailable'));
  }
}

export class SelectionToolbarSurfaceController {
  private mountedSurface: SelectionToolbarMountedSurface | null = null;
  private currentSnapshot: EditorSelectionSnapshot | null = null;
  private mode: SurfaceMode = 'toolbar';
  private inlineEdit: InlineEditState | null = null;
  private composerDefaults: ComposerDefaults | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly plugin: PiviPlugin) {}

  register(): void {
    const host = getSelectionToolbarHost();
    if (!host) {
      return;
    }

    this.unsubscribers.push(
      host.onShow(snapshot => {
        this.currentSnapshot = snapshot;
        this.mode = 'toolbar';
        this.inlineEdit = null;
        this.render();
        host.repositionOverlay();
      }),
      host.onDismiss(() => {
        this.cleanupInlineEdit();
        this.currentSnapshot = null;
        this.mode = 'toolbar';
        this.inlineEdit = null;
        this.disposeSurface();
      }),
    );

    this.plugin.register(() => {
      this.destroy();
    });
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.cleanupInlineEdit();
    this.disposeSurface();
  }

  private disposeSurface(): void {
    void this.mountedSurface?.dispose();
    this.mountedSurface = null;
  }

  private cleanupInlineEdit(): void {
    const snapshot = this.currentSnapshot;
    if (snapshot) {
      hideSelectionHighlight(snapshot.editorView);
    }
  }

  private dismiss(): void {
    getSelectionToolbarHost()?.dismissOverlay();
  }

  private ensureSurface(): SelectionToolbarMountedSurface {
    const host = getSelectionToolbarHost();
    if (!host) {
      throw new Error('Selection toolbar host is not registered.');
    }

    if (!this.mountedSurface) {
      this.mountedSurface = mountSelectionToolbarSurface({
        container: host.getOverlayElement(),
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
        props: this.buildProps(),
      });
      host.getOverlayElement().addEventListener(
        'pivi-selection-toolbar-mounted',
        () => host.repositionOverlay(),
        { once: true },
      );
      return this.mountedSurface;
    }

    this.mountedSurface.update(this.buildProps());
    return this.mountedSurface;
  }

  private render(): void {
    this.ensureSurface();
    getSelectionToolbarHost()?.repositionOverlay();
  }

  private buildProps(): SelectionToolbarSurfaceProps {
    if (this.mode === 'inline-edit' && this.inlineEdit && this.composerDefaults) {
      return {
        mode: 'inline-edit',
        adaptiveReasoning: this.composerDefaults.adaptiveReasoning,
        defaultReasoningValue: this.composerDefaults.defaultReasoningValue,
        errorMessage: this.inlineEdit.errorMessage,
        model: this.inlineEdit.model,
        modelOptions: this.composerDefaults.modelOptions,
        onAccept: () => void this.handleAccept(),
        onCancel: () => this.dismiss(),
        onModelChange: (model) => {
          if (!this.inlineEdit || !this.composerDefaults) return;
          const uiFacades = this.plugin.getUiFacades();
          const settings = uiFacades.getSettingsSnapshot(this.plugin.settings);
          this.inlineEdit.model = model;
          this.composerDefaults.thinkingOptions = uiFacades.chatUIConfig
            .getReasoningOptions(model, settings)
            .map(option => ({ ...option }));
          this.composerDefaults.adaptiveReasoning = uiFacades.chatUIConfig
            .isAdaptiveReasoningModel(model, settings);
          this.composerDefaults.defaultReasoningValue = uiFacades.chatUIConfig
            .getDefaultReasoningValue(model, settings);
          this.render();
        },
        onPromptChange: (prompt) => {
          if (!this.inlineEdit) return;
          this.inlineEdit.prompt = prompt;
          this.render();
        },
        onReject: () => this.dismiss(),
        onSend: () => void this.handleSend(),
        onThinkingChange: (thinkingLevel) => {
          if (!this.inlineEdit) return;
          this.inlineEdit.thinkingLevel = thinkingLevel;
          this.render();
        },
        prompt: this.inlineEdit.prompt,
        resultPreview: this.inlineEdit.resultPreview,
        status: this.inlineEdit.status,
        thinkingLevel: this.inlineEdit.thinkingLevel,
        thinkingOptions: this.composerDefaults.thinkingOptions,
      };
    }

    const shortcuts = getEnabledShortcuts(this.plugin.settings).map(shortcut => ({
      id: shortcut.id,
      label: shortcut.label,
      kind: shortcut.kind,
      ...(shortcut.icon ? { icon: shortcut.icon } : {}),
    }));

    return {
      mode: 'toolbar',
      shortcuts,
      onAddToChat: () => void this.handleAddToChat(),
      onAskAi: () => this.openInlineEdit(),
      onShortcut: (id) => void this.handleShortcut(id),
    };
  }

  private openInlineEdit(prefillPrompt = ''): void {
    const defaults = getComposerDefaults(this.plugin);
    this.composerDefaults = defaults;
    this.mode = 'inline-edit';
    this.inlineEdit = {
      prompt: prefillPrompt,
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
      status: 'idle',
    };
    this.render();
    getSelectionToolbarHost()?.repositionOverlay();
  }

  private async handleAddToChat(): Promise<void> {
    const markdownView = resolveActiveMarkdownView(this.plugin);
    const editor = markdownView?.editor;
    if (!editor || !markdownView) {
      new Notice(t('editor.selectionToolbar.noActiveEditor'));
      this.dismiss();
      return;
    }

    await this.plugin.addEditorSelectionToChatInput(editor, markdownView);
    this.dismiss();
  }

  private handleShortcut(id: string): void {
    const shortcut = getEnabledShortcuts(this.plugin.settings).find(entry => entry.id === id);
    if (!shortcut || !this.currentSnapshot) {
      return;
    }

    if (shortcut.kind === 'obsidian-command') {
      if (!shortcut.commandId) {
        new Notice(t('editor.selectionToolbar.commandUnavailable'));
        this.dismiss();
        return;
      }
      executeObsidianCommand(this.plugin, shortcut.commandId);
      this.dismiss();
      return;
    }

    if (!shortcut.piviCommandKey) {
      new Notice(t('editor.selectionToolbar.commandUnavailable'));
      this.dismiss();
      return;
    }

    executeObsidianCommand(
      this.plugin,
      getWorkspaceCommandFullId(this.plugin.manifest.id, shortcut.piviCommandKey),
    );
    this.dismiss();
  }

  private async handleSend(): Promise<void> {
    if (!this.inlineEdit) {
      return;
    }
    const prompt = this.inlineEdit.prompt.trim();
    if (!prompt) {
      new Notice(t('editor.inlineEdit.emptyPrompt'));
      return;
    }
    await this.runInlineEditTurn(prompt);
  }

  private async runInlineEditTurn(prompt: string): Promise<void> {
    const snapshot = this.currentSnapshot;
    if (!snapshot || !this.inlineEdit) {
      return;
    }

    const view = await ensurePiviViewOpen(
      this.plugin.app,
      this.plugin.settings.chatViewPlacement,
    );
    if (!view) {
      this.inlineEdit.status = 'error';
      this.inlineEdit.errorMessage = t('editor.inlineEdit.chatUnavailable');
      this.render();
      return;
    }

    try {
      await this.plugin.ensureWorkspaceServices();
    } catch {
      this.inlineEdit.status = 'error';
      this.inlineEdit.errorMessage = t('editor.inlineEdit.chatUnavailable');
      this.render();
      return;
    }

    const content = buildInlineEditTurnContent(prompt, snapshot.text);
    this.inlineEdit.status = 'streaming';
    this.inlineEdit.errorMessage = undefined;
    this.inlineEdit.resultPreview = undefined;
    this.render();
    showSelectionHighlight(snapshot.editorView, snapshot.from, snapshot.to);

    const result = await view.getChatHandle()?.commands.submitInlineEditTurn({
      content,
      model: this.inlineEdit.model,
      thinkingLevel: this.inlineEdit.thinkingLevel,
      draftTitle: prompt.slice(0, 80),
    }) ?? null;

    if (!result || !result.assistantText.trim()) {
      this.inlineEdit.status = 'error';
      this.inlineEdit.errorMessage = t('editor.inlineEdit.failed');
      this.render();
      return;
    }

    this.inlineEdit.status = 'ready';
    this.inlineEdit.resultPreview = result.assistantText;
    this.render();
  }

  private handleAccept(): void {
    const snapshot = this.currentSnapshot;
    const result = this.inlineEdit?.resultPreview;
    if (!snapshot || !result) {
      this.dismiss();
      return;
    }

    const markdownView = resolveActiveMarkdownView(this.plugin);
    const editor = markdownView?.editor;
    if (!editor) {
      new Notice(t('editor.selectionToolbar.noActiveEditor'));
      this.dismiss();
      return;
    }

    applyInlineEditAcceptance(editor, snapshot.from, snapshot.to, result);
    this.dismiss();
  }
}

export function registerSelectionToolbarUi(plugin: PiviPlugin): void {
  const controller = new SelectionToolbarSurfaceController(plugin);
  controller.register();
}
