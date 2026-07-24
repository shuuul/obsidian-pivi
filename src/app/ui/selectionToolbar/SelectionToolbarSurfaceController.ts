import {
  EDITOR_COMMANDS,
  type EditorToolbarPiviCommand,
  type EditorToolbarShortcut,
} from '@pivi/pivi-agent-core/foundation/settings';
import { resolveWorkspaceCommandPrompt } from '@pivi/pivi-agent-core/skills/commands/resolveWorkspaceCommandPrompt';
import {
  mountSelectionToolbarSurface,
  type SelectionToolbarMountedSurface,
  type SelectionToolbarSurfaceProps,
} from '@pivi/pivi-react/mount';
import type { ComposerOptionSnapshot } from '@pivi/pivi-react/store';
import type { Editor } from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';

import {
  getSelectionToolbarHost,
} from '@/app/editorSelectionToolbarRegistration';
import type { PiviPluginHost } from '@/app/hostContracts';
import { appI18n, t } from '@/app/i18n';
import { ensurePiviViewOpen } from '@/app/piviViewActivation';
import { buildInlineEditTurnContent } from '@/app/ui/inlineEditHelpers';
import {
  parseInlineEditTurnResponse,
  stripInlineEditStreamingProtocolTags,
} from '@/app/ui/inlineEditProtocol';
import {
  InlineEditSurfaceSession,
} from '@/app/ui/inlineEditSurface';
import type { InlineEditSurfaceSendPayload } from '@/app/ui/inlineEditSurface/types';
import { listObsidianCommands } from '@/app/ui/listObsidianCommands';
import { obsidianPresentationPlatform } from '@/app/ui/obsidianPresentationPlatform';
import { getWorkspaceCommandFullId } from '@/app/workspaceCommandRegistry';
import type PiviPlugin from '@/main';
import { captureEditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/selectionToolbarPlugin';
import type { EditorSelectionSnapshot } from '@/ui/shared/selectionToolbar/types';

type ComposerDefaults = {
  model: string;
  thinkingLevel: string;
  modelOptions: ComposerOptionSnapshot[];
  thinkingOptions: ComposerOptionSnapshot[];
  adaptiveReasoning: boolean;
  defaultReasoningValue: string;
};

interface InlineEditRecord {
  readonly snapshot: EditorSelectionSnapshot;
  readonly session: InlineEditSurfaceSession;
  turnInFlight: boolean;
  cancel: (() => void) | null;
  attempt: number;
}

interface OriginatingMarkdownContext {
  readonly view: MarkdownView;
  readonly file: MarkdownView['file'];
}

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

function captureOriginatingMarkdownContext(
  plugin: PiviPluginHost,
  snapshot: EditorSelectionSnapshot,
): OriginatingMarkdownContext | null {
  const editor = snapshot.editor;
  if (!editor) {
    const view = resolveActiveMarkdownView(plugin);
    return view ? { view, file: view.file } : null;
  }
  const view = plugin.app.workspace.getLeavesOfType('markdown')
    .map(leaf => leaf.view)
    .find((candidate): candidate is MarkdownView => (
      candidate instanceof MarkdownView && candidate.editor === editor
    ));
  return view ? { view, file: view.file } : null;
}

function stillOwnsSnapshot(
  plugin: PiviPluginHost,
  snapshot: EditorSelectionSnapshot,
  origin: OriginatingMarkdownContext,
): boolean {
  return origin.view.file === origin.file
    && (!snapshot.editor || origin.view.editor === snapshot.editor)
    && plugin.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view === origin.view);
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
  private mountedSurfaceContainer: HTMLElement | null = null;
  private currentSnapshot: EditorSelectionSnapshot | null = null;
  private readonly inlineEditSessions = new Map<string, InlineEditRecord>();
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
        this.render();
        host.repositionOverlay();
      }),
      host.onDismiss(() => {
        this.currentSnapshot = null;
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
    for (const record of [...this.inlineEditSessions.values()]) this.destroyInlineEditSession(record);
    this.disposeSurface();
  }

  openInlineEditForSelection(editor: Editor): boolean {
    const snapshot = captureEditorSelectionSnapshot(editor);
    if (!snapshot) {
      return false;
    }
    return this.openInlineEdit('', snapshot) !== null;
  }

  private disposeSurface(): void {
    void this.mountedSurface?.dispose();
    this.mountedSurface = null;
    this.mountedSurfaceContainer = null;
  }

  private destroyInlineEditSession(record: InlineEditRecord): void {
    record.attempt++;
    record.cancel?.();
    record.cancel = null;
    record.session.destroy();
    this.inlineEditSessions.delete(record.session.id);
  }

  private dismissRecord(record: InlineEditRecord): void {
    this.destroyInlineEditSession(record);
  }

  private ensureSurface(): SelectionToolbarMountedSurface {
    const host = getSelectionToolbarHost();
    if (!host) {
      throw new Error('Selection toolbar host is not registered.');
    }

    const container = host.getOverlayElement();
    if (this.mountedSurface && this.mountedSurfaceContainer !== container) {
      this.disposeSurface();
    }

    if (!this.mountedSurface) {
      this.mountedSurface = mountSelectionToolbarSurface({
        container,
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
        props: this.buildProps(),
      });
      this.mountedSurfaceContainer = container;
      container.addEventListener(
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
    if (getEnabledShortcuts(this.plugin.settings).length === 0) {
      this.disposeSurface();
      getSelectionToolbarHost()?.dismissOverlay();
      return;
    }
    this.ensureSurface();
    getSelectionToolbarHost()?.repositionOverlay();
  }

  private buildProps(): SelectionToolbarSurfaceProps {
    const items = getEnabledShortcuts(this.plugin.settings).map(shortcut => {
      if (shortcut.kind === 'pivi-action') {
        return {
          id: shortcut.id,
          kind: shortcut.kind,
          label: t(shortcut.actionId === 'inline-edit'
            ? 'editor.selectionToolbar.askAi'
            : 'editor.selectionToolbar.addToChat'),
          icon: shortcut.actionId === 'inline-edit' ? 'pivi-p' : 'message-square-plus',
        } as const;
      }
      if (shortcut.kind === 'editor-command') {
        const catalog = EDITOR_COMMANDS.find(command => command.id === shortcut.commandId);
        return {
          id: shortcut.id,
          kind: shortcut.kind,
          label: listObsidianCommands(this.plugin.app).find(command => command.id === shortcut.commandId)?.name
            ?? shortcut.commandId,
          ...(catalog ? { icon: catalog.icon } : {}),
        } as const;
      }
      return { id: shortcut.id, label: shortcut.label, kind: shortcut.kind, ...(shortcut.icon ? { icon: shortcut.icon } : {}) };
    });

    return {
      items,
      onItem: (id) => void this.handleShortcut(id),
    };
  }

  private openInlineEdit(
    prefillPrompt = '',
    snapshotOverride: EditorSelectionSnapshot | null = null,
  ): InlineEditRecord | null {
    const host = getSelectionToolbarHost();
    // Prefer the live host snapshot when the controller copy was cleared by a
    // dismiss/leaf-change race while the toolbar button click is still in flight.
    const snapshot = snapshotOverride ?? this.currentSnapshot ?? host?.getCurrentSnapshot() ?? null;
    if (!snapshot) {
      return null;
    }

    // Dismiss the transient toolbar fully so a later Ask AI cannot reuse a stale
    // range from another file. Inline-edit sessions are independent of dismiss.
    host?.dismissOverlay();
    this.currentSnapshot = null;
    this.disposeSurface();

    const defaults = getComposerDefaults(this.plugin);
    let record: InlineEditRecord;
    const session = new InlineEditSurfaceSession(
      {
        plugin: this.plugin,
        i18n: appI18n,
        platform: obsidianPresentationPlatform,
        composerDefaults: defaults,
        getWorkspace: async () => this.plugin.ensureWorkspaceServices(),
      },
      {
        onSend: (payload) => void this.handleInlineEditSend(record, payload),
        onReject: () => this.dismissRecord(record),
        onDiffReject: () => this.dismissRecord(record),
        onAccept: () => this.dismissRecord(record),
        onStop: () => {
          record.attempt++;
          record.cancel?.();
          record.cancel = null;
          record.turnInFlight = false;
          if (!record.session.isDestroyed()) record.session.setStreaming(false);
        },
      },
    );
    record = { snapshot, session, turnInFlight: false, cancel: null, attempt: 0 };
    this.inlineEditSessions.set(session.id, record);
    session.show(snapshot);
    if (prefillPrompt.trim()) {
      session.setPrompt(prefillPrompt);
    }
    return record;
  }

  private dismissToolbarAndRestoreEditorFocus(): void {
    const snapshot = this.currentSnapshot ?? getSelectionToolbarHost()?.getCurrentSnapshot() ?? null;
    getSelectionToolbarHost()?.dismissOverlay();
    this.currentSnapshot = null;
    snapshot?.editor?.focus();
    snapshot?.editorView?.focus();
  }

  private async handleAddToChat(): Promise<void> {
    const markdownView = resolveActiveMarkdownView(this.plugin);
    const editor = markdownView?.editor;
    if (!editor || !markdownView) {
      new Notice(t('editor.selectionToolbar.noActiveEditor'));
      this.dismissToolbarAndRestoreEditorFocus();
      return;
    }

    await this.plugin.addEditorSelectionToChatInput(editor, markdownView);
    this.dismissToolbarAndRestoreEditorFocus();
  }

  private async handleShortcut(id: string): Promise<void> {
    const shortcut = getEnabledShortcuts(this.plugin.settings).find(entry => entry.id === id);
    if (!shortcut) return;

    switch (shortcut.kind) {
      case 'pivi-action':
        switch (shortcut.actionId) {
          case 'inline-edit': this.openInlineEdit(); return;
          case 'add-to-chat': await this.handleAddToChat(); return;
        }
        return;
      case 'obsidian-command':
      case 'editor-command':
        executeObsidianCommand(this.plugin, shortcut.commandId);
        this.dismissToolbarAndRestoreEditorFocus();
        return;
      case 'pivi-command':
        if (!shortcut.piviCommandKey) {
          new Notice(t('editor.selectionToolbar.commandUnavailable'));
          this.dismissToolbarAndRestoreEditorFocus();
          return;
        }
        if ((shortcut.executionTarget ?? 'sidebar') === 'sidebar') {
          executeObsidianCommand(
            this.plugin,
            getWorkspaceCommandFullId(this.plugin.manifest.id, shortcut.piviCommandKey),
          );
          this.dismissToolbarAndRestoreEditorFocus();
          return;
        }
        if (this.currentSnapshot) {
          const snapshot = this.currentSnapshot;
          const origin = captureOriginatingMarkdownContext(this.plugin, snapshot);
          if (origin) await this.runPiviCommandInline(shortcut, snapshot, origin);
        }
    }
  }

  private async runPiviCommandInline(
    shortcut: EditorToolbarPiviCommand,
    snapshot: EditorSelectionSnapshot,
    origin: OriginatingMarkdownContext,
  ): Promise<void> {
    if (!snapshot.text) {
      new Notice(t('chat.errors.noTextSelected'));
      this.dismissToolbarAndRestoreEditorFocus();
      return;
    }
    let workspace;
    try {
      workspace = await this.plugin.ensureWorkspaceServices();
    } catch {
      new Notice(t('editor.inlineEdit.chatUnavailable'));
      return;
    }
    let entries;
    try {
      entries = await workspace.slashCommandCatalog.listWorkspaceEntries();
    } catch {
      new Notice(t('commands.workspaceCommandUnavailable'));
      return;
    }
    const entry = entries.find(candidate => (
      candidate.kind === 'command' && candidate.integrationKey === shortcut.piviCommandKey
    ));
    if (!entry) {
      new Notice(t('commands.workspaceCommandUnavailable'));
      getSelectionToolbarHost()?.dismissOverlay();
      return;
    }
    if (!stillOwnsSnapshot(this.plugin, snapshot, origin)) return;
    const file = origin.file;
    let currentNote = '';
    try {
      currentNote = file ? await this.plugin.app.vault.read(file) : '';
    } catch {
      new Notice(t('commands.workspaceCommandUnavailable'));
      return;
    }
    if (!stillOwnsSnapshot(this.plugin, snapshot, origin)) return;
    const prompt = resolveWorkspaceCommandPrompt(entry.content, {
      // Inline edit carries the exact selection once in buildInlineEditTurnContent.
      selectedText: '',
      currentNote,
      currentNoteName: file?.basename ?? '',
      date: new Date().toLocaleDateString(),
    }).trim();
    if (!prompt) {
      new Notice(t('commands.workspaceCommandEmpty'));
      getSelectionToolbarHost()?.dismissOverlay();
      return;
    }
    const record = this.openInlineEdit(prompt, snapshot);
    if (!record) return;
    const defaults = getComposerDefaults(this.plugin);
    await this.runInlineEditTurn(record, {
      prompt,
      contextFiles: [],
      model: defaults.model,
      thinkingLevel: defaults.thinkingLevel,
    });
  }

  private async handleInlineEditSend(record: InlineEditRecord, payload: InlineEditSurfaceSendPayload): Promise<void> {
    if (!this.isInlineEditSessionAlive(record)) {
      return;
    }

    const prompt = payload.prompt.trim();
    if (!prompt) {
      new Notice(t('editor.inlineEdit.emptyPrompt'));
      return;
    }

    await this.runInlineEditTurn(record, payload);
  }

  private isInlineEditSessionAlive(record: InlineEditRecord): boolean {
    return this.inlineEditSessions.get(record.session.id) === record && !record.session.isDestroyed();
  }

  private async runInlineEditTurn(
    record: InlineEditRecord,
    payload: InlineEditSurfaceSendPayload,
  ): Promise<void> {
    if (record.turnInFlight) {
      return;
    }
    const attempt = ++record.attempt;
    record.turnInFlight = true;
    const { snapshot, session } = record;
    session.setStreaming(true);
    session.setReplyText('');

    try {
      const prompt = payload.prompt.trim();
      const view = await ensurePiviViewOpen(
        this.plugin.app,
        this.plugin.settings.chatViewPlacement,
      );
      if (!view) {
        if (this.isInlineEditSessionAlive(record) && record.attempt === attempt) {
          session.setStreaming(false);
          session.showError(t('editor.inlineEdit.chatUnavailable'));
        }
        return;
      }

      try {
        await this.plugin.ensureWorkspaceServices();
      } catch {
        if (this.isInlineEditSessionAlive(record) && record.attempt === attempt) {
          session.setStreaming(false);
          session.showError(t('editor.inlineEdit.chatUnavailable'));
        }
        return;
      }

      if (!this.isInlineEditSessionAlive(record) || record.attempt !== attempt) {
        return;
      }

      const content = buildInlineEditTurnContent(prompt, snapshot.text, payload.contextFiles);
      const result = await view.getChatHandle()?.commands.submitInlineEditTurn({
        content,
        model: payload.model,
        thinkingLevel: payload.thinkingLevel,
        draftTitle: prompt.slice(0, 80),
        registerCancel: (cancel) => {
          if (this.isInlineEditSessionAlive(record) && record.attempt === attempt) record.cancel = cancel;
          else cancel();
        },
        onAssistantText: (accumulatedText) => {
          if (!this.isInlineEditSessionAlive(record) || record.attempt !== attempt) {
            return;
          }
          session.setReplyText(stripInlineEditStreamingProtocolTags(accumulatedText));
        },
      }) ?? null;

      if (!this.isInlineEditSessionAlive(record) || record.attempt !== attempt) {
        return;
      }

      session.setStreaming(false);

      if (!result || !result.assistantText.trim()) {
        session.showError(t('editor.inlineEdit.failed'));
        return;
      }

      const parsed = parseInlineEditTurnResponse(result.assistantText);
      switch (parsed.kind) {
        case 'reply':
          session.setReplyText(parsed.text);
          break;
        case 'replacement':
          session.showDiffReview(snapshot.text, parsed.text, 'replacement');
          break;
        case 'insertion':
          session.showDiffReview('', parsed.text, 'insertion');
          break;
        case 'empty':
          session.showError(t('editor.inlineEdit.failed'));
          break;
      }
    } finally {
      if (record.attempt === attempt) {
        record.cancel = null;
        record.turnInFlight = false;
      }
    }
  }
}

let registeredSelectionToolbarController: SelectionToolbarSurfaceController | null = null;

export function openInlineEditForEditorSelection(editor: Editor): boolean {
  return registeredSelectionToolbarController?.openInlineEditForSelection(editor) ?? false;
}

export function registerSelectionToolbarUi(plugin: PiviPlugin): void {
  const controller = new SelectionToolbarSurfaceController(plugin);
  registeredSelectionToolbarController = controller;
  controller.register();
  plugin.register(() => {
    if (registeredSelectionToolbarController === controller) {
      registeredSelectionToolbarController = null;
    }
  });
}
