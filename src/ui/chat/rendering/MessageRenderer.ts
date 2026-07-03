import { resolveUserMessageDisplayText } from '@pivi/pivi-agent-core/context/context';
import { formatDurationMmSs } from '@pivi/pivi-agent-core/context/date';
import type { ChatMessage, ImageAttachment, SubagentInfo, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_WRITE_STDIN,
} from '@pivi/pivi-agent-core/tools/toolNames';
import { extractToolResultContent } from '@pivi/pivi-agent-core/tools/toolResultContent';
import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Notice, setIcon } from 'obsidian';

import type PiviPlugin from '@/app/PiviPluginHost';
import { t } from '@/i18n';
import type { MentionBadgeParseContext } from '@/ui/shared/mention/mentionBadgeTypes';
import { buildExternalContextLookupFromPaths } from '@/ui/shared/mention/parseMessageMentions';
import { renderMentionBadges } from '@/ui/shared/mention/renderMentionBadges';

import { buildExternalContextDisplayEntries } from '../../shared/utils/externalContext';
import { externalContextScanner } from '../../shared/utils/externalContextScanner';
import {
  normalizeObsidianAppLinksInMarkdown,
  processFileLinks,
  registerFileLinkHandler,
} from '../../shared/utils/fileLink';
import { escapeMathDelimitersForStreaming } from '../../shared/utils/markdownMath';
import { trimEmptyEdgeParagraphs } from './markdownContentCleanup';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';
import { renderStoredToolCall } from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

export class MessageRenderer {
  private app: App;
  private plugin: PiviPlugin;
  private component: Component;
  private messagesEl: HTMLElement;
  private forkCallback?: (messageId: string) => Promise<void>;
  private liveMessageEls = new Map<string, HTMLElement>();

  constructor(
    plugin: PiviPlugin,
    component: Component,
    messagesEl: HTMLElement,
    forkCallback?: (messageId: string) => Promise<void>,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.forkCallback = forkCallback;

    // Register delegated click handler for file links
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(toolName);
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `pivi-message pivi-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
        void this.renderUserMessageText(textEl, textToShow);
      }
      this.refreshMessageActions(msgEl, msg);
    }

    if (this.forkCallback) {
      this.liveMessageEls.set(msg.id, msgEl);
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.pivi-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const textToShow = resolveUserMessageDisplayText(msg);
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
      void this.renderUserMessageText(textEl, textToShow);
    }

    this.refreshMessageActions(msgEl, msg);
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for session load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();

    // Recreate welcome element after clearing
    const newWelcomeEl = this.messagesEl.createDiv({ cls: 'pivi-welcome' });
    newWelcomeEl.createDiv({ cls: 'pivi-welcome-greeting', text: getGreeting() });

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Bare interrupt marker: user-role interrupts always render
    // as a standalone indicator. Assistant-role partial responses
    // only use the bare marker when there's no content to preserve.
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      if (!resolveUserMessageDisplayText(msg)) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `pivi-message pivi-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = resolveUserMessageDisplayText(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
        void this.renderUserMessageText(textEl, textToShow);
      }
      this.refreshMessageActions(msgEl, msg, allMessages, index);
    } else if (msg.role === 'assistant') {
      this.renderAssistantContent(msg, contentEl);
      if (msg.isInterrupt) {
        this.appendInterruptIndicator(contentEl);
      }
      this.refreshMessageActions(msgEl, msg, allMessages, index);
    }
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    if (msg.content && msg.content.trim().length > 0) return true;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking' && block.content.trim().length > 0) return true;
        if (block.type === 'text' && block.content.trim().length > 0) return true;
        if (block.type === 'context_compacted') return true;
        if (block.type === 'subagent') return true;
        if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall && this.shouldRenderToolCall(toolCall)) return true;
        }
      }
    }
    if (msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall))) return true;
    return false;
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'pivi-message pivi-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'pivi-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
    textEl.createSpan({ cls: 'pivi-interrupted', text: 'Interrupted' });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'pivi-interrupted-hint',
      text: '\u00B7 What should Pivi do instead?',
    });
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          if (!block.content || !block.content.trim()) {
            continue;
          }
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md)
          );
        } else if (block.type === 'text') {
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          if (!block.content || !block.content.trim()) {
            continue;
          }
          const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
          void this.renderContent(textEl, block.content);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            this.renderToolCall(contentEl, toolCall, msg);
            renderedToolIds.add(toolCall.id);
          }
        } else if (block.type === 'context_compacted') {
          const boundaryEl = contentEl.createDiv({ cls: 'pivi-compact-boundary' });
          boundaryEl.createSpan({ cls: 'pivi-compact-boundary-label', text: 'Session compacted' });
        } else if (block.type === 'subagent') {
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
          );
          if (!taskToolCall) continue;

          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        }
      }

      // Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload.
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          if (renderedToolIds.has(toolCall.id)) continue;
          this.renderToolCall(contentEl, toolCall, msg);
          renderedToolIds.add(toolCall.id);
        }
      }
    } else {
      // Fallback for old sessions without contentBlocks
      if (msg.content) {
        const textEl = contentEl.createDiv({ cls: 'pivi-text-block' });
        void this.renderContent(textEl, msg.content);
      }
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          this.renderToolCall(contentEl, toolCall, msg);
        }
      }
    }

    // Render response duration footer (skip when message contains a compaction boundary)
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (msg.durationSeconds && msg.durationSeconds > 0 && !hasCompactBoundary) {
      const flavorWord = msg.durationFlavorWord || 'Baked';
      const footerEl = contentEl.createDiv({ cls: 'pivi-response-footer' });
      footerEl.createSpan({
        text: `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`,
        cls: 'pivi-baked-duration',
      });
    }
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and subagent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall);
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(contentEl, toolCall);
    }
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  private renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
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

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
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

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'pivi-message-images' });

    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: 'pivi-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
        },
      });

      void this.setImageSrc(imgEl, image);

      // Click to view full size
      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'pivi-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'pivi-image-modal' });

    modal.createEl('img', {
      attr: {
        src: dataUri,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'pivi-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  /**
   * Sets image src from attachment data.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;
    imgEl.setAttribute('src', dataUri);
  }

  // ============================================
  // Content Rendering
  // ============================================

  private buildMentionBadgeContext(): MentionBadgeParseContext {
    const mcpManager = this.plugin.getPiWorkspace()?.mcpServerManager ?? null;
    const mcpServerNames = new Set(
      (mcpManager?.getServers() ?? []).map((server) => server.name),
    );
    const skillCommandNames = new Set(
      this.plugin
        .getPiWorkspace()
        ?.skillProvider.listSkills()
        .map((skill) => skill.name) ?? [],
    );
    const externalPaths = this.plugin.settings.persistentExternalContextPaths ?? [];

    return {
      app: this.app,
      mcpServerNames,
      skillCommandNames,
      externalContextEntries: buildExternalContextDisplayEntries(externalPaths),
      getExternalContextLookup: buildExternalContextLookupFromPaths(
        externalPaths,
        (roots) => externalContextScanner.scanPaths(roots),
      ),
    };
  }

  private async renderUserMessageText(el: HTMLElement, text: string): Promise<void> {
    if (renderMentionBadges(el, text, this.buildMentionBadgeContext())) {
      return;
    }
    await this.renderContent(el, text);
  }

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.addClass('markdown-rendered');
    el.addClass('pivi-markdown-rendered');
    el.empty();

    try {
      const normalizedMarkdown = normalizeObsidianAppLinksInMarkdown(markdown);
      const renderMarkdown = options?.deferMath
        ? escapeMathDelimitersForStreaming(normalizedMarkdown)
        : normalizedMarkdown;
      await MarkdownRenderer.render(
        this.app,
        renderMarkdown,
        el,
        this.getMarkdownRenderSourcePath(),
        this.component
      );

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('pivi-code-wrapper')) return;

        // Create wrapper
        const wrapper = createEl('div', { cls: 'pivi-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Check for language class and add label
        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = createEl('span', {
              cls: 'pivi-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            label.addEventListener('click', () => {
              runRendererAction(async () => {
                const originalLabel = match[1];
                if (!originalLabel) return;

                try {
                  await navigator.clipboard.writeText(code.textContent || '');
                  label.setText('Copied!');
                  window.setTimeout(() => label.setText(originalLabel), 1500);
                } catch {
                  // Clipboard API may fail in non-secure contexts
                }
              });
            });
          }
        }

        // Move Obsidian's copy button outside pre into wrapper
        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Process wikilinks only when the source can contain them; the DOM pass is expensive.
      if (renderMarkdown.includes('[[')) {
        processFileLinks(this.app, el);
      }

      trimEmptyEdgeParagraphs(el);
    } catch {
      el.createDiv({
        cls: 'pivi-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  private getMarkdownRenderSourcePath(): string {
    return this.app.workspace.getActiveFile()?.path ?? '';
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) return;

    this.refreshMessageActions(msgEl, msg, allMessages, index);
    this.liveMessageEls.delete(msg.id);
  }

  private refreshMessageActions(
    msgEl: HTMLElement,
    msg: ChatMessage,
    _allMessages?: ChatMessage[],
    _index?: number,
  ): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl, msg.role);
    toolbar.empty();

    const copyContent = this.getMessageCopyContent(msg);
    if (copyContent) {
      this.addMessageCopyButton(toolbar, copyContent, msg.role);
    }

    if (msg.role === 'assistant') {
      this.addScrollToRecentUserButton(toolbar);
      this.addScrollToTopButton(toolbar);
    }

    if (msg.role === 'user' && this.forkCallback && this.getForkEntryId(msg)) {
      this.addForkButton(toolbar, msg.id);
    }

    if (toolbar.children.length === 0) {
      toolbar.remove();
    }
  }

  private getMessageCopyContent(msg: ChatMessage): string {
    if (msg.role === 'user') {
      return resolveUserMessageDisplayText(msg);
    }

    const textBlocks = msg.contentBlocks
      ?.filter((block): block is { type: 'text'; content: string } => block.type === 'text')
      .map((block) => block.content.trim())
      .filter((content) => content.length > 0);
    if (textBlocks && textBlocks.length > 0) {
      return textBlocks.join('\n\n');
    }
    return msg.content.trim();
  }

  private getForkEntryId(msg: ChatMessage): string | undefined {
    return msg.role === 'user' ? msg.userMessageId : msg.assistantMessageId;
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement, role: ChatMessage['role']): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.pivi-message-actions, .pivi-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({
      cls: [
        'pivi-message-actions',
        role === 'user' ? 'pivi-user-msg-actions' : 'pivi-assistant-msg-actions',
      ],
    });
  }

  private createActionButton(
    toolbar: HTMLElement,
    cls: string | string[],
    icon: string,
    ariaLabel: string,
  ): HTMLButtonElement {
    const btn = toolbar.createEl('button', {
      cls: ['pivi-message-action-btn', ...(Array.isArray(cls) ? cls : [cls])],
      attr: { type: 'button' },
    });
    setIcon(btn, icon);
    btn.setAttribute('aria-label', ariaLabel);
    return btn;
  }

  private addMessageCopyButton(toolbar: HTMLElement, content: string, role: ChatMessage['role']): void {
    const copyBtn = this.createActionButton(
      toolbar,
      role === 'user'
        ? ['pivi-message-copy-btn', 'pivi-user-msg-copy-btn']
        : ['pivi-message-copy-btn', 'pivi-assistant-msg-copy-btn'],
      'copy',
      role === 'assistant'
        ? t('chat.messageActions.copyAgentResponseAriaLabel')
        : t('chat.messageActions.copyAriaLabel'),
    );
    const copyContent = normalizeObsidianAppLinksInMarkdown(content);

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await navigator.clipboard.writeText(copyContent);
        } catch {
          return;
        }
        if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
        copyBtn.empty();
        setIcon(copyBtn, 'check');
        copyBtn.classList.add('copied');
        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  private addScrollToRecentUserButton(toolbar: HTMLElement): void {
    const btn = this.createActionButton(
      toolbar,
      'pivi-message-scroll-user-btn',
      'user',
      t('chat.messageActions.scrollToRecentUserAriaLabel'),
    );
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = this.findMostRecentUserElement();
      if (!target) return;
      this.jumpToMessage(target);
    });
  }

  private addScrollToTopButton(toolbar: HTMLElement): void {
    const btn = this.createActionButton(
      toolbar,
      'pivi-message-scroll-top-btn',
      'arrow-up',
      t('chat.messageActions.scrollToTopAriaLabel'),
    );
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.messagesEl.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  private addForkButton(toolbar: HTMLElement, messageId: string): void {
    const btn = this.createActionButton(toolbar, 'pivi-message-fork-btn', 'git-fork', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
    });
  }

  private findMostRecentUserElement(): HTMLElement | null {
    const userMessages = this.messagesEl.querySelectorAll<HTMLElement>('.pivi-message[data-role="user"]');
    return userMessages.length > 0 ? userMessages[userMessages.length - 1] : null;
  }

  private jumpToMessage(target: HTMLElement): void {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.classList.add('pivi-message-jump-target');

    window.setTimeout(() => {
      target.classList.remove('pivi-message-jump-target');
    }, 1200);
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages container to bottom. */
  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      window.requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

}
