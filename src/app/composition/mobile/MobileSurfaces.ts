import type { SlashCommand } from '@pivi/pivi-agent-core/foundation';
import type { SlashCommandDropdownConfig } from '@pivi/pivi-agent-core/skills/commands/slashCommandCatalog';
import type { SlashCatalogEntry } from '@pivi/pivi-agent-core/skills/commands/slashCommandEntry';
import {
  COMPACT_COMMAND_ID,
  NEW_SESSION_COMMAND_ID,
} from '@pivi/pivi-agent-core/skills/commands/slashCommandIds';
import type { Plugin, SettingDefinitionItem, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Modal, PluginSettingTab, setIcon, Setting } from 'obsidian';

import { t } from '@/app/i18n';
import { SlashCommandDropdown } from '@/ui/shared/components/SlashCommandDropdown';
import { createMentionVaultLookup } from '@/ui/shared/mention/createMentionVaultLookup';
import { MentionDropdownController } from '@/ui/shared/mention/MentionDropdownController';
import { MentionInput } from '@/ui/shared/mention/MentionInput';
import { getVaultFileAliases } from '@/ui/shared/mention/obsidianMentionVault';
import { VaultMentionDataProvider } from '@/ui/shared/mention/VaultMentionDataProvider';

import {
  MobileChatController,
  type MobileChatViewState,
} from './MobileChatController';
import { activeProviderId } from './mobileProviderPolicy';
import {
  deleteMobileProviderKey,
  saveMobileProviderSettings,
} from './mobileProviderSettings';
import type { MobileWorkspace } from './MobileWorkspace';

const VIEW_TYPE = 'pivi-mobile-view';
const MOBILE_SLASH_CONFIG: SlashCommandDropdownConfig = {
  triggerChars: ['/'],
  builtInPrefix: '/',
  skillPrefix: '/',
  commandPrefix: '/',
};
const MOBILE_SLASH_ENTRIES: SlashCatalogEntry[] = [
  {
    id: COMPACT_COMMAND_ID,
    kind: 'command',
    name: COMPACT_COMMAND_ID,
    description: 'Compact this session to preserve context',
    content: '/compact',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
  {
    id: NEW_SESSION_COMMAND_ID,
    kind: 'command',
    name: NEW_SESSION_COMMAND_ID,
    description: t('chat.slash.newSessionDescription'),
    content: '',
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  },
];

class Approval extends Modal {
  constructor(
    app: Plugin['app'],
    private readonly name: string,
    private readonly done: (value: boolean) => void,
    private readonly signal: AbortSignal,
  ) {
    super(app);
  }

  private settled = false;

  private readonly onAbort = (): void => {
    this.settle(false);
    this.close();
  };

  onOpen(): void {
    if (this.signal.aborted) {
      this.onAbort();
      return;
    }
    this.signal.addEventListener('abort', this.onAbort, { once: true });
    new Setting(this.contentEl)
      .setName(`${this.name} wants to change your vault.`)
      .addButton(b => b.setButtonText('Deny').onClick(() => {
        this.settle(false);
        this.close();
      }))
      .addButton(b => b.setCta().setButtonText('Allow once').onClick(() => {
        this.settle(true);
        this.close();
      }));
  }

  onClose(): void {
    this.signal.removeEventListener('abort', this.onAbort);
    this.settle(false);
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.done(value);
  }
}

class SessionTextPrompt extends Modal {
  constructor(
    app: Plugin['app'],
    private readonly initialValue: string,
    private readonly done: (value: string | null) => void,
  ) { super(app); }

  private settled = false;

  onOpen(): void {
    let value = this.initialValue;
    new Setting(this.contentEl).setName('Rename session').addText(input => {
      input.setValue(value).onChange(next => { value = next; });
      input.inputEl.select();
    }).addButton(button => button.setCta().setButtonText('Rename').onClick(() => {
      this.settle(value);
      this.close();
    }));
  }

  onClose(): void { this.settle(null); }

  private settle(value: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.done(value);
  }
}

class DeleteSessionConfirmation extends Modal {
  constructor(app: Plugin['app'], private readonly done: (confirmed: boolean) => void) { super(app); }
  private settled = false;

  onOpen(): void {
    new Setting(this.contentEl)
      .setName('Delete this session?')
      .setDesc('This removes it from session history on every synced device. This cannot be undone.')
      .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(button => {
        // Keep the 1.12-compatible warning class until the minimum host version reaches 1.13.
        button.buttonEl.addClass('mod-warning');
        button.setButtonText('Delete session').onClick(() => {
          this.settle(true);
          this.close();
        });
      });
  }

  onClose(): void { this.settle(false); }
  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.done(value);
  }
}

class View extends ItemView {
  private controller: MobileChatController | null = null;
  private unsubscribe: (() => void) | null = null;
  private messagesEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private sessionLabelEl: HTMLElement | null = null;
  private sessionSelectEl: HTMLSelectElement | null = null;
  private composerEl: MentionInput | null = null;
  private mentionDropdown: MentionDropdownController | null = null;
  private slashDropdown: SlashCommandDropdown | null = null;
  private mentionData: VaultMentionDataProvider | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private retryButton: HTMLButtonElement | null = null;
  private latestState: MobileChatViewState | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly workspace: MobileWorkspace,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Pivi';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen(): Promise<void> {
    const el = this.containerEl.children[1] as HTMLElement;
    el.empty();
    el.addClass('pivi-mobile-chat');

    const header = el.createDiv({ cls: 'pivi-mobile-chat-header' });
    this.sessionLabelEl = header.createDiv({
      cls: 'pivi-mobile-chat-session-title',
      text: 'Pivi',
    });
    const headerActions = header.createDiv({ cls: 'pivi-mobile-chat-header-actions' });
    const newChatButton = headerActions.createEl('button', {
      cls: 'pivi-mobile-chat-icon-button',
      attr: { 'aria-label': t('chat.tabs.startNewChat'), title: t('chat.tabs.startNewChat') },
    });
    setIcon(newChatButton, 'square-pen');
    newChatButton.addEventListener('click', () => this.controller?.newChat());
    const moreButton = headerActions.createEl('button', {
      cls: 'pivi-mobile-chat-icon-button',
      attr: { 'aria-label': 'Session actions', title: 'Session actions' },
    });
    setIcon(moreButton, 'ellipsis');
    moreButton.addEventListener('click', event => this.openSessionMenu(event));

    const sessionBar = el.createDiv({ cls: 'pivi-mobile-chat-session-bar' });
    this.sessionSelectEl = sessionBar.createEl('select', {
      cls: 'pivi-mobile-chat-sessions',
      attr: { 'aria-label': 'Sessions' },
    });
    this.sessionSelectEl.addEventListener('change', () => {
      const value = this.sessionSelectEl?.value;
      if (value) void this.controller?.pickSession(value);
    });

    this.statusEl = el.createDiv({ cls: 'pivi-mobile-chat-status', text: '' });
    this.messagesEl = el.createDiv({ cls: 'pivi-mobile-chat-messages' });

    const composerWrap = el.createDiv({
      cls: 'pivi-mobile-chat-composer pivi-input-container',
    });
    const composerSurface = composerWrap.createDiv({
      cls: 'pivi-mobile-chat-composer-surface pivi-input-wrapper',
    });
    const mentionContext = () => ({
      vault: createMentionVaultLookup(this.app),
      mcpServerNames: new Set<string>(),
    });
    this.composerEl = new MentionInput(composerSurface, {
      app: this.app,
      className: 'pivi-mobile-chat-input',
      placeholder: t('chat.composer.placeholder'),
      getMentionContext: mentionContext,
    });
    this.composerEl.el.setAttribute('aria-label', t('chat.composer.placeholder'));
    this.composerEl.el.setAttribute('dir', 'auto');

    this.mentionData = new VaultMentionDataProvider(this.app);
    this.mentionData.initializeInBackground();
    this.mentionDropdown = new MentionDropdownController(composerWrap, this.composerEl, {
      onAttachFile: () => undefined,
      getMentionedMcpServers: () => new Set(),
      setMentionedMcpServers: () => false,
      addMentionedMcpServer: () => undefined,
      getExternalContexts: () => [],
      getCachedVaultFolders: () => this.mentionData?.getCachedVaultFolders() ?? [],
      getCachedVaultFiles: () => this.mentionData?.getCachedVaultFiles() ?? [],
      getVaultFileAliases: file => getVaultFileAliases(this.app, file),
      getActiveVaultFilePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      normalizePathForVault: path => path?.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || null,
    });
    this.mentionDropdown.setMcpManager(null);
    this.mentionDropdown.setAgentService(null);

    this.slashDropdown = new SlashCommandDropdown(composerWrap, this.composerEl, {
      onSelect: command => this.handleSlashCommand(command),
    }, {
      catalogConfig: MOBILE_SLASH_CONFIG,
      getCatalogEntries: () => Promise.resolve(MOBILE_SLASH_ENTRIES),
    });
    void this.slashDropdown.prefetchCaches();

    const handleComposerInput = (): void => {
      this.mentionDropdown?.handleInputChange();
      this.controller?.setComposer(this.composerEl?.value ?? '');
    };
    this.composerEl.addEventListener('input', handleComposerInput);
    this.composerEl.el.addEventListener('paste', event => {
      this.composerEl?.handlePaste(event);
      handleComposerInput();
    });
    this.composerEl.addEventListener('keydown', event => {
      const keyboardEvent = event as KeyboardEvent;
      if (this.slashDropdown?.handleKeydown(keyboardEvent)) return;
      this.mentionDropdown?.handleKeydown(keyboardEvent);
    });

    const actions = composerSurface.createDiv({ cls: 'pivi-mobile-chat-actions' });
    const triggers = actions.createDiv({ cls: 'pivi-mobile-chat-triggers' });
    for (const trigger of ['@', '/'] as const) {
      const button = triggers.createEl('button', {
        cls: 'pivi-mobile-chat-trigger',
        text: trigger,
        attr: { type: 'button', 'aria-label': trigger === '@' ? 'Add context' : t('chat.slash.ariaLabel') },
      });
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => this.insertComposerTrigger(trigger));
    }
    this.retryButton = actions.createEl('button', {
      cls: 'pivi-mobile-chat-retry',
      attr: { type: 'button', 'aria-label': 'Retry', title: 'Retry' },
    });
    setIcon(this.retryButton, 'rotate-ccw');
    this.retryButton.addEventListener('click', () => {
      void this.controller?.retry();
    });
    this.sendButton = actions.createEl('button', {
      cls: 'pivi-mobile-chat-send',
      attr: { type: 'button', 'aria-label': t('chat.composer.sendAria'), title: t('chat.composer.sendTitle') },
    });
    setIcon(this.sendButton, 'arrow-up');
    this.sendButton.addEventListener('click', () => {
      void this.controller?.send();
    });
    this.stopButton = actions.createEl('button', {
      cls: 'pivi-mobile-chat-stop',
      attr: { type: 'button', 'aria-label': t('chat.composer.stopAria'), title: t('chat.composer.stopTitle') },
    });
    setIcon(this.stopButton, 'square');
    this.stopButton.addEventListener('click', () => {
      this.controller?.stop();
    });

    this.controller = new MobileChatController(this.workspace, {
      render: state => this.applyState(state),
    });
    this.unsubscribe = this.workspace.onSurfacesChanged(() => {
      this.controller?.refreshReadiness();
    });
    await this.controller.open();
  }

  onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.controller?.close();
    this.controller = null;
    this.mentionDropdown?.destroy();
    this.mentionDropdown = null;
    this.slashDropdown?.destroy();
    this.slashDropdown = null;
    this.composerEl?.destroy();
    this.mentionData = null;
    this.latestState = null;
    this.messagesEl = null;
    this.statusEl = null;
    this.sessionLabelEl = null;
    this.sessionSelectEl = null;
    this.composerEl = null;
    this.sendButton = null;
    this.stopButton = null;
    this.retryButton = null;
    return Promise.resolve();
  }

  private applyState(state: MobileChatViewState): void {
    this.latestState = state;
    if (this.sessionLabelEl) {
      this.sessionLabelEl.setText(state.sessionTitle);
    }
    if (this.statusEl) {
      const text = state.status
        || (state.readiness.ready ? '' : state.readiness.missing.join(' '));
      this.statusEl.setText(text);
      this.statusEl.toggleClass('is-visible', text.length > 0);
    }
    if (this.sessionSelectEl) {
      this.sessionSelectEl.empty();
      const blank = this.sessionSelectEl.createEl('option', { text: 'Sessions' });
      blank.value = '';
      for (const session of state.sessions) {
        const option = this.sessionSelectEl.createEl('option', {
          text: session.title || session.messagePreview || session.sessionFile,
        });
        option.value = session.sessionFile;
        if (session.sessionFile === state.sessionFile) option.selected = true;
      }
      if (state.showArchived && state.archivedSessions.length) {
        const heading = this.sessionSelectEl.createEl('option', { text: 'Archived sessions' });
        heading.disabled = true;
        for (const session of state.archivedSessions) {
          const option = this.sessionSelectEl.createEl('option', {
            text: `Archived: ${session.title || session.messagePreview || session.sessionFile}`,
          });
          option.value = session.sessionFile;
          if (session.sessionFile === state.sessionFile) option.selected = true;
        }
      }
    }
    if (this.messagesEl) {
      this.messagesEl.empty();
      if (state.rows.length === 0) {
        const empty = this.messagesEl.createDiv({ cls: 'pivi-mobile-chat-empty' });
        const icon = empty.createDiv({ cls: 'pivi-mobile-chat-empty-icon' });
        setIcon(icon, 'message-circle');
        empty.createDiv({ cls: 'pivi-mobile-chat-empty-title', text: t('chat.tabs.startNewChat') });
        empty.createDiv({ cls: 'pivi-mobile-chat-empty-hint', text: '@ notes  ·  / commands' });
      }
      for (const row of state.rows) {
        const rowEl = this.messagesEl.createDiv({
          cls: `pivi-mobile-chat-row pivi-mobile-chat-row--${row.kind}`,
        });
        if (row.toolName) {
          rowEl.createDiv({
            cls: 'pivi-mobile-chat-tool-name',
            text: row.toolName,
          });
        }
        // textContent via setText — never innerHTML for untrusted model/tool output.
        rowEl.createDiv({
          cls: 'pivi-mobile-chat-row-text',
          text: row.text,
        });
      }
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
    if (this.composerEl && this.composerEl.value !== state.composer) {
      this.composerEl.value = state.composer;
    }
    if (this.sendButton) this.sendButton.disabled = !state.canSend;
    if (this.sendButton) this.sendButton.toggleClass('is-hidden', state.canStop);
    if (this.stopButton) this.stopButton.toggleClass('is-hidden', !state.canStop);
    if (this.retryButton) this.retryButton.toggleClass('is-hidden', !state.canRetry);
  }

  private insertComposerTrigger(trigger: '@' | '/'): void {
    const input = this.composerEl;
    if (!input) return;
    const value = input.value;
    const cursor = input.selectionStart;
    const prefix = cursor === 0 || /\s/.test(value[cursor - 1] ?? '') ? '' : ' ';
    input.insertReplacement(value.slice(0, cursor), `${prefix}${trigger}`, value.slice(cursor));
    input.focus();
    this.controller?.setComposer(input.value);
    if (trigger === '@') this.mentionDropdown?.handleInputChange();
    else this.slashDropdown?.handleInputChange();
  }

  private handleSlashCommand(command: SlashCommand): void {
    if (command.id !== NEW_SESSION_COMMAND_ID) {
      this.controller?.setComposer(this.composerEl?.value ?? '');
      return;
    }
    this.controller?.newChat();
    this.composerEl?.focus();
  }

  private openSessionMenu(event: MouseEvent): void {
    const state = this.latestState;
    const menu = new Menu();
    menu.addItem(item => item.setTitle('Rename').setIcon('pencil').onClick(() => {
      new SessionTextPrompt(this.app, this.sessionLabelEl?.textContent ?? '', value => {
        if (value) void this.controller?.rename(value);
      }).open();
    }));
    menu.addItem(item => item.setTitle('Fork').setIcon('git-fork').onClick(() => {
      void this.controller?.fork();
    }));
    const archived = !!state?.sessionFile
      && state.archivedSessions.some(session => session.sessionFile === state.sessionFile);
    menu.addItem(item => item
      .setTitle(archived ? 'Restore' : 'Archive')
      .setIcon(archived ? 'archive-restore' : 'archive')
      .onClick(() => archived ? this.controller?.restore() : this.controller?.archive()));
    menu.addSeparator();
    menu.addItem(item => item
      .setTitle(state?.showArchived ? 'Hide archived sessions' : 'Show archived sessions')
      .setIcon('history')
      .onClick(() => this.controller?.setShowArchived(!state?.showArchived)));
    menu.addItem(item => item.setTitle(t('common.delete')).setIcon('trash-2').onClick(() => {
      new DeleteSessionConfirmation(this.app, confirmed => {
        if (confirmed) void this.controller?.deleteCurrent();
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }
}

class SettingsTab extends PluginSettingTab {
  private unsubscribe: (() => void) | null = null;

  constructor(
    owner: Plugin,
    private readonly workspace: MobileWorkspace,
  ) {
    super(owner.app, owner);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: 'Pivi mobile',
      desc: 'Provider, model, and per-device API key.',
      render: s => this.render(s.settingEl),
    }];
  }

  display(): void {
    this.containerEl.empty();
    this.render(this.containerEl);
    this.unsubscribe?.();
    this.unsubscribe = this.workspace.onSurfacesChanged(() => {
      this.containerEl.empty();
      this.render(this.containerEl);
    });
  }

  hide(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(el: HTMLElement): void {
    const state = this.workspace.providers.loadInitialized();
    let provider = activeProviderId(state) ?? 'anthropic';
    const activeModel = state?.modelPreferences.activeModel ?? '';
    let model = activeModel.includes('/') ? activeModel.slice(activeModel.indexOf('/') + 1) : '';
    let key = '';

    new Setting(el)
      .setName('Provider')
      .addText(x => x.setValue(provider).onChange(v => {
        provider = v;
      }));

    new Setting(el)
      .setName('Model')
      .addText(x => x.setValue(model).onChange(v => {
        model = v;
      }));

    const keySetting = new Setting(el)
      .setName('API key')
      .setDesc(this.workspace.hasApiKey(provider)
        ? 'Stored on this device.'
        : 'Not stored on this device.');

    let keyInput: HTMLInputElement | null = null;
    keySetting.addText(x => {
      x.inputEl.type = 'password';
      keyInput = x.inputEl;
      x.onChange(v => {
        key = v;
      });
    });

    keySetting
      .addButton(b => b.setButtonText('Save').onClick(() => {
        const result = saveMobileProviderSettings(this.workspace, {
          providerId: provider,
          modelId: model,
          apiKey: key,
        });
        key = '';
        if (keyInput) keyInput.value = '';
        if (!result.ok) {
          keySetting.setDesc(result.error);
          return;
        }
        // Never write the API key back into the DOM after save.
        keySetting.setDesc('Stored on this device.');
      }))
      .addButton(b => b.setButtonText('Delete').onClick(() => {
        const result = deleteMobileProviderKey(this.workspace, provider);
        key = '';
        if (keyInput) keyInput.value = '';
        keySetting.setDesc(result.ok
          ? 'Not stored on this device.'
          : result.error);
      }));
  }
}

export function registerMobileSurfaces(owner: Plugin, workspace: MobileWorkspace): void {
  owner.registerView(VIEW_TYPE, leaf => new View(leaf, workspace));
  owner.addRibbonIcon('message-circle', 'Open Pivi', () => {
    void owner.app.workspace.getRightLeaf(false)?.setViewState({ type: VIEW_TYPE, active: true });
  });
  owner.addSettingTab(new SettingsTab(owner, workspace));
}

export function requestMobileApproval(
  app: Plugin['app'],
  name: string,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise(resolve => new Approval(app, name, resolve, signal).open());
}

export { VIEW_TYPE as MOBILE_VIEW_TYPE };
