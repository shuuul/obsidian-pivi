import type { EditorView } from "@codemirror/view";
import {
  getVaultPath,
  normalizePathForVault as normalizePathForVaultUtil,
} from "@pivi/obsidian-host/path";
import { createPiAuxQueryRunner } from "@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner";
import { getHiddenSlashCommandSet } from "@pivi/pivi-agent-core/foundation/settings";
import type {
  InlineEditMode,
  InlineEditService,
} from "@pivi/pivi-agent-core/runtime/auxTypes";
import { QueryBackedInlineEditService } from "@pivi/pivi-agent-core/runtime/queryBackedInlineEditService";
import type { App, Editor } from "obsidian";
import { Notice } from "obsidian";

import type PiviPlugin from "@/app/PiviPluginHost";
import {
  hideSelectionHighlight,
  showSelectionHighlight,
} from "@/ui/shared/components/SelectionHighlight";
import { SlashCommandDropdown } from "@/ui/shared/components/SlashCommandDropdown";
import { MentionDropdownController } from "@/ui/shared/mention/MentionDropdownController";
import { VaultMentionDataProvider } from "@/ui/shared/mention/VaultMentionDataProvider";

import {
  createExternalContextLookupGetter,
  findBestMentionLookupMatch,
  isMentionStart,
  normalizeForPlatformLookup,
  normalizeMentionPath,
  resolveExternalMentionAtIndex,
} from "../../shared/utils/contextMentionResolver";
import { type CursorContext } from "../../shared/utils/editor";
import { buildExternalContextDisplayEntries } from "../../shared/utils/externalContext";
import { externalContextScanner } from "../../shared/utils/externalContextScanner";
import { normalizeInsertionText } from "../../shared/utils/inlineEdit";
import {
  hideInlineEdit,
  installInlineEditExtension,
  showDiff,
  showInlineEdit,
  showInsertion,
} from "./inlineEditCodeMirror";
import {
  computeDiff,
  type DiffOp,
} from "./inlineEditDiff";
import type { InlineEditContext, InlineEditDecision } from "./inlineEditTypes";

export let activeInlineEditController: InlineEditController | null = null;

export function getActiveInlineEditController(): InlineEditController | null {
  return activeInlineEditController;
}

export function setActiveInlineEditController(
  controller: InlineEditController | null,
): void {
  activeInlineEditController = controller;
}

export class InlineEditController {
  private inputEl: HTMLInputElement | null = null;
  private spinnerEl: HTMLElement | null = null;
  private agentReplyEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private editedText: string | null = null;
  private insertedText: string | null = null;
  private selFrom = 0;
  private selTo = 0;
  private selectedText: string;
  private startLine: number = 0; // 1-indexed
  private mode: InlineEditMode;
  private cursorContext: CursorContext | null = null;
  private inlineEditService: InlineEditService;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private selectionListener: ((e: Event) => void) | null = null;
  private isConversing = false;
  private slashCommandDropdown: SlashCommandDropdown | null = null;
  private mentionDropdown: MentionDropdownController | null = null;
  private mentionDataProvider: VaultMentionDataProvider;

  constructor(
    private app: App,
    private plugin: PiviPlugin,
    private editorView: EditorView,
    private editor: Editor,
    editContext: InlineEditContext,
    private notePath: string,
    private getExternalContexts: () => string[],
    private resolve: (result: {
      decision: InlineEditDecision;
      editedText?: string;
    }) => void,
  ) {
    const activeTab = plugin.getView()?.getActiveTab();
    this.inlineEditService = new QueryBackedInlineEditService(
      createPiAuxQueryRunner(plugin),
    );
    const auxiliaryModel =
      activeTab?.service?.getAuxiliaryModel?.() ??
      activeTab?.draftModel ??
      null;
    this.inlineEditService.setModelOverride?.(auxiliaryModel ?? undefined);
    this.mentionDataProvider = new VaultMentionDataProvider(this.app, {
      onFileLoadError: () => {
        new Notice(
          "Failed to load vault files. Vault @-mentions may be unavailable.",
        );
      },
    });
    this.mentionDataProvider.initializeInBackground();
    this.mode = editContext.mode;
    if (editContext.mode === "cursor") {
      this.cursorContext = editContext.cursorContext;
      this.selectedText = "";
    } else {
      this.selectedText = editContext.selectedText;
    }

    this.updatePositionsFromEditor();
  }

  getOwnerDocument(): Document {
    return this.editorView.dom.ownerDocument ?? window.document;
  }

  private updatePositionsFromEditor() {
    const doc = this.editorView.state.doc;

    if (this.mode === "cursor") {
      const ctx = this.cursorContext as CursorContext;
      const line = doc.line(ctx.line + 1);
      this.selFrom = line.from + ctx.column;
      this.selTo = this.selFrom;
    } else {
      const from = this.editor.getCursor("from");
      const to = this.editor.getCursor("to");
      const fromLine = doc.line(from.line + 1);
      const toLine = doc.line(to.line + 1);
      this.selFrom = fromLine.from + from.ch;
      this.selTo = toLine.from + to.ch;
      this.selectedText = this.editor.getSelection() || this.selectedText;
      this.startLine = from.line + 1; // 1-indexed
    }
  }

  show() {
    installInlineEditExtension(this.editorView);

    this.editorView.dom.classList.add("pivi-inline-edit-modal");

    this.updateHighlight();

    if (this.mode === "selection") {
      this.attachSelectionListeners();
    }

    // !e.isComposing: skip during IME composition (Chinese, Japanese, Korean, etc.)
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        this.reject();
      }
    };
    this.getOwnerDocument().addEventListener("keydown", this.escHandler);
  }

  private updateHighlight() {
    const doc = this.editorView.state.doc;
    const line = doc.lineAt(this.selFrom);
    const isInbetween =
      this.mode === "cursor" && this.cursorContext?.isInbetween;

    this.editorView.dispatch({
      effects: showInlineEdit.of({
        inputPos: isInbetween ? this.selFrom : line.from,
        selFrom: this.selFrom,
        selTo: this.selTo,
        widget: this,
        isInbetween,
      }),
    });
    this.updateSelectionHighlight();
  }

  private updateSelectionHighlight(): void {
    if (this.mode === "selection" && this.selFrom !== this.selTo) {
      showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
    } else {
      hideSelectionHighlight(this.editorView);
    }
  }

  private attachSelectionListeners() {
    this.removeSelectionListeners();
    this.selectionListener = (e: Event) => {
      const target = e.target as Node | null;
      if (
        target &&
        this.inputEl &&
        (target === this.inputEl || this.inputEl.contains(target))
      ) {
        return;
      }
      const prevFrom = this.selFrom;
      const prevTo = this.selTo;
      const newSelection = this.editor.getSelection();
      if (newSelection && newSelection.length > 0) {
        this.updatePositionsFromEditor();
        if (prevFrom !== this.selFrom || prevTo !== this.selTo) {
          this.updateHighlight();
        }
      }
    };
    this.editorView.dom.addEventListener("mouseup", this.selectionListener);
    this.editorView.dom.addEventListener("keyup", this.selectionListener);
  }

  createInputDOM(): HTMLElement {
    const ownerDocument = this.getOwnerDocument();
    const container = ownerDocument.createElement("div");
    container.className = "pivi-inline-input-container";
    this.containerEl = container;

    this.agentReplyEl = ownerDocument.createElement("div");
    this.agentReplyEl.className = "pivi-inline-agent-reply pivi-hidden";
    container.appendChild(this.agentReplyEl);

    const inputWrap = ownerDocument.createElement("div");
    inputWrap.className = "pivi-inline-input-wrap";
    container.appendChild(inputWrap);

    this.inputEl = ownerDocument.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.className = "pivi-inline-input";
    this.inputEl.placeholder =
      this.mode === "cursor"
        ? "Insert instructions..."
        : "Edit instructions...";
    this.inputEl.spellcheck = false;
    inputWrap.appendChild(this.inputEl);

    this.spinnerEl = ownerDocument.createElement("div");
    this.spinnerEl.className = "pivi-inline-spinner pivi-hidden";
    inputWrap.appendChild(this.spinnerEl);

    this.slashCommandDropdown = new SlashCommandDropdown(
      ownerDocument.body,
      this.inputEl,
      {
        onSelect: () => {},
        onHide: () => {},
      },
      {
        fixed: true,
        hiddenCommands: getHiddenSlashCommandSet(this.plugin.settings),
      },
    );

    this.mentionDropdown = new MentionDropdownController(
      ownerDocument.body,
      this.inputEl,
      {
        // Inline-edit resolves @mentions at send time from input text.
        onAttachFile: () => {},
        onMcpMentionChange: () => {},
        getMentionedMcpServers: () => new Set(),
        setMentionedMcpServers: () => false,
        addMentionedMcpServer: () => {},
        getExternalContexts: this.getExternalContexts,
        getCachedVaultFolders: () =>
          this.mentionDataProvider.getCachedVaultFolders(),
        getCachedVaultFiles: () =>
          this.mentionDataProvider.getCachedVaultFiles(),
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath),
      },
      { fixed: true },
    );

    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
    this.inputEl.addEventListener("input", () =>
      this.mentionDropdown?.handleInputChange(),
    );

    window.setTimeout(() => this.inputEl?.focus(), 50);
    return container;
  }

  private async generate() {
    if (!this.inputEl || !this.spinnerEl) return;
    const userMessage = this.inputEl.value.trim();
    if (!userMessage) return;

    // Slash commands are passed directly to SDK for handling

    this.removeSelectionListeners();

    this.inputEl.disabled = true;
    this.spinnerEl.removeClass("pivi-hidden");

    const contextFiles = this.resolveContextFilesFromMessage(userMessage);

    let result;
    if (this.isConversing) {
      result = await this.inlineEditService.continueSession(
        userMessage,
        contextFiles,
      );
    } else {
      if (this.mode === "cursor") {
        result = await this.inlineEditService.editText({
          mode: "cursor",
          instruction: userMessage,
          notePath: this.notePath,
          cursorContext: this.cursorContext as CursorContext,
          contextFiles,
        });
      } else {
        const lineCount = this.selectedText.split(/\r?\n/).length;
        result = await this.inlineEditService.editText({
          mode: "selection",
          instruction: userMessage,
          notePath: this.notePath,
          selectedText: this.selectedText,
          startLine: this.startLine,
          lineCount,
          contextFiles,
        });
      }
    }

    this.spinnerEl.addClass("pivi-hidden");

    if (result.success) {
      if (result.editedText !== undefined) {
        this.editedText = result.editedText;
        this.showDiffInPlace();
      } else if (result.insertedText !== undefined) {
        this.insertedText = result.insertedText;
        this.showInsertionInPlace();
      } else if (result.clarification) {
        this.showAgentReply(result.clarification);
        this.isConversing = true;
        this.inputEl.disabled = false;
        this.inputEl.value = "";
        this.inputEl.placeholder = "Reply to continue...";
        this.inputEl.focus();
      } else {
        this.handleError("No response from agent");
      }
    } else {
      this.handleError(result.error || "Error - try again");
    }
  }

  private showAgentReply(message: string) {
    if (!this.agentReplyEl || !this.containerEl) return;
    this.agentReplyEl.removeClass("pivi-hidden");
    this.agentReplyEl.textContent = message;
    this.containerEl.classList.add("has-agent-reply");
  }

  private handleError(errorMessage: string) {
    if (!this.inputEl) return;
    this.inputEl.disabled = false;
    this.inputEl.placeholder = errorMessage;
    this.updatePositionsFromEditor();
    this.updateHighlight();
    this.attachSelectionListeners();
    this.inputEl.focus();
  }

  private showDiffInPlace() {
    if (this.editedText === null) return;

    hideSelectionHighlight(this.editorView);

    const diffOps = computeDiff(this.selectedText, this.editedText);

    this.editorView.dispatch({
      effects: showDiff.of({
        from: this.selFrom,
        to: this.selTo,
        diffOps,
        widget: this,
      }),
    });

    this.installAcceptRejectHandler();
  }

  private showInsertionInPlace() {
    if (this.insertedText === null) return;

    hideSelectionHighlight(this.editorView);

    const trimmedText = normalizeInsertionText(this.insertedText);
    this.insertedText = trimmedText;

    const diffOps: DiffOp[] = [{ type: "insert", text: trimmedText }];

    this.editorView.dispatch({
      effects: showInsertion.of({
        pos: this.selFrom,
        diffOps,
        widget: this,
      }),
    });

    this.installAcceptRejectHandler();
  }

  private installAcceptRejectHandler() {
    if (this.escHandler) {
      this.getOwnerDocument().removeEventListener("keydown", this.escHandler);
    }
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        this.reject();
      } else if (e.key === "Enter" && !e.isComposing) {
        this.accept();
      }
    };
    this.getOwnerDocument().addEventListener("keydown", this.escHandler);
  }

  accept() {
    const textToInsert = this.editedText ?? this.insertedText;
    if (textToInsert !== null) {
      // Convert CM6 positions back to Obsidian Editor positions
      const doc = this.editorView.state.doc;
      const fromLine = doc.lineAt(this.selFrom);
      const toLine = doc.lineAt(this.selTo);
      const from = {
        line: fromLine.number - 1,
        ch: this.selFrom - fromLine.from,
      };
      const to = { line: toLine.number - 1, ch: this.selTo - toLine.from };

      this.cleanup();
      this.editor.replaceRange(textToInsert, from, to);
      this.resolve({ decision: "accept", editedText: textToInsert });
    } else {
      this.cleanup();
      this.resolve({ decision: "reject" });
    }
  }

  reject() {
    this.cleanup({ keepSelectionHighlight: true });
    this.restoreSelectionHighlight();
    this.resolve({ decision: "reject" });
  }

  private removeSelectionListeners() {
    if (this.selectionListener) {
      this.editorView.dom.removeEventListener(
        "mouseup",
        this.selectionListener,
      );
      this.editorView.dom.removeEventListener("keyup", this.selectionListener);
      this.selectionListener = null;
    }
  }

  private cleanup(options?: { keepSelectionHighlight?: boolean }) {
    this.inlineEditService.cancel();
    this.inlineEditService.resetSession();
    this.isConversing = false;
    this.removeSelectionListeners();
    if (this.escHandler) {
      this.getOwnerDocument().removeEventListener("keydown", this.escHandler);
    }
    this.slashCommandDropdown?.destroy();
    this.slashCommandDropdown = null;

    this.mentionDropdown?.destroy();
    this.mentionDropdown = null;

    if (activeInlineEditController === this) {
      activeInlineEditController = null;
    }
    this.editorView.dom.classList.remove("pivi-inline-edit-modal");
    this.editorView.dispatch({
      effects: hideInlineEdit.of(null),
    });
    if (!options?.keepSelectionHighlight) {
      hideSelectionHighlight(this.editorView);
    }
  }

  private restoreSelectionHighlight(): void {
    if (this.mode !== "selection" || this.selFrom === this.selTo) {
      return;
    }
    showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.mentionDropdown?.handleKeydown(e)) {
      return;
    }

    if (this.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      void this.generate();
    }
  }

  private normalizePathForVault(
    rawPath: string | undefined | null,
  ): string | null {
    try {
      const vaultPath = getVaultPath(this.app);
      return normalizePathForVaultUtil(rawPath, vaultPath);
    } catch {
      new Notice("Failed to attach file: invalid path");
      return null;
    }
  }

  private resolveContextFilesFromMessage(message: string): string[] {
    if (!message.includes("@")) return [];

    const vaultFiles = this.mentionDataProvider.getCachedVaultFiles();

    const pathLookup = new Map<string, string>();
    for (const file of vaultFiles) {
      const normalized = this.normalizePathForVault(file.path);
      if (!normalized) continue;
      const lookupKey = normalizeForPlatformLookup(
        normalizeMentionPath(normalized),
      );
      if (!pathLookup.has(lookupKey)) {
        pathLookup.set(lookupKey, normalized);
      }
    }

    const resolved = new Set<string>();
    const externalEntries = buildExternalContextDisplayEntries(
      this.getExternalContexts(),
    ).sort((a, b) => b.displayNameLower.length - a.displayNameLower.length);
    const getExternalLookup = createExternalContextLookupGetter((contextRoot) =>
      externalContextScanner.scanPaths([contextRoot]),
    );

    for (let index = 0; index < message.length; index++) {
      if (!isMentionStart(message, index)) continue;

      const externalMatch = resolveExternalMentionAtIndex(
        message,
        index,
        externalEntries,
        getExternalLookup,
      );
      if (externalMatch) {
        resolved.add(externalMatch.resolvedPath);
        index = externalMatch.endIndex - 1;
        continue;
      }

      const vaultMatch = findBestMentionLookupMatch(
        message,
        index + 1,
        pathLookup,
        normalizeMentionPath,
        normalizeForPlatformLookup,
      );
      if (vaultMatch) {
        resolved.add(vaultMatch.resolvedPath);
        index = vaultMatch.endIndex - 1;
      }
    }

    return [...resolved];
  }
}