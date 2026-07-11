import { parseCommand } from '@pivi/pivi-agent-core/mcp/mcpUtils';
import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpOAuthConfig,
  McpRemoteAuthMode,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '@pivi/pivi-agent-core/mcp/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '@pivi/pivi-agent-core/mcp/types';
import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import { t } from '@/i18n';

export class McpServerModal extends Modal {
  private existingServer: ManagedMcpServer | null;
  private onSave: (server: ManagedMcpServer) => void;

  private serverName = '';
  private serverType: McpServerType = 'stdio';
  private enabled = DEFAULT_MCP_SERVER.enabled;
  private contextSaving = DEFAULT_MCP_SERVER.contextSaving;
  private command = '';
  private env = '';
  private url = '';
  private headers = '';
  private authMode: 'auto' | McpRemoteAuthMode = 'auto';
  private oauthGrantType: 'authorization_code' | 'client_credentials' = 'authorization_code';
  private oauthClientId = '';
  private oauthClientSecret = '';
  private oauthScope = '';
  private bearerToken = '';
  private bearerTokenEnv = '';
  private typeFieldsEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    existingServer: ManagedMcpServer | null,
    onSave: (server: ManagedMcpServer) => void,
    initialType?: McpServerType,
    prefillConfig?: { name: string; config: McpServerConfig }
  ) {
    super(app);
    this.existingServer = existingServer;
    this.onSave = onSave;

    if (existingServer) {
      this.serverName = existingServer.name;
      this.serverType = getMcpServerType(existingServer.config);
      this.enabled = existingServer.enabled;
      this.contextSaving = existingServer.contextSaving;
      this.initFromConfig(existingServer.config);
      this.initAuthFromServer(existingServer);
    } else if (prefillConfig) {
      this.serverName = prefillConfig.name;
      this.serverType = getMcpServerType(prefillConfig.config);
      this.initFromConfig(prefillConfig.config);
    } else if (initialType) {
      this.serverType = initialType;
    }
  }

  private initAuthFromServer(server: ManagedMcpServer) {
    if (server.oauth === false || server.auth === 'none') {
      this.authMode = 'none';
      return;
    }
    if (server.auth === 'bearer') {
      this.authMode = 'bearer';
      this.bearerToken = server.bearerToken ?? '';
      this.bearerTokenEnv = server.bearerTokenEnv ?? '';
      return;
    }
    if (server.auth === 'oauth' || server.oauth) {
      this.authMode = 'oauth';
      const oauth = server.oauth && typeof server.oauth === 'object' ? server.oauth : undefined;
      this.oauthGrantType = oauth?.grantType ?? 'authorization_code';
      this.oauthClientId = oauth?.clientId ?? '';
      this.oauthClientSecret = oauth?.clientSecret ?? '';
      this.oauthScope = oauth?.scope ?? '';
    }
  }

  private initFromConfig(config: McpServerConfig) {
    const type = getMcpServerType(config);
    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      if (stdioConfig.args && stdioConfig.args.length > 0) {
        this.command = stdioConfig.command + ' ' + stdioConfig.args.join(' ');
      } else {
        this.command = stdioConfig.command;
      }
      this.env = this.envRecordToString(stdioConfig.env);
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      this.url = urlConfig.url;
      this.headers = this.envRecordToString(urlConfig.headers);
    }
  }

  onOpen() {
    this.setTitle(
      this.existingServer
        ? t('settings.mcp.modal.titleEdit')
        : t('settings.mcp.modal.titleAdd'),
    );
    this.modalEl.addClass('pivi-mcp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.serverName'))
      .setDesc(t('settings.mcp.modal.serverNameDesc'))
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.serverName);
        text.setPlaceholder(t('settings.mcp.modal.serverNamePlaceholder'));
        text.onChange((value) => {
          this.serverName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.type'))
      .setDesc(t('settings.mcp.modal.connectionType'))
      .addDropdown((dropdown) => {
        dropdown.addOption('stdio', t('settings.mcp.modal.typeStdioOption'));
        dropdown.addOption('sse', t('settings.mcp.modal.typeSseOption'));
        dropdown.addOption('http', t('settings.mcp.modal.typeHttpOption'));
        dropdown.setValue(this.serverType);
        dropdown.onChange((value) => {
          this.serverType = value as McpServerType;
          this.renderTypeFields();
        });
      });

    this.typeFieldsEl = contentEl.createDiv({ cls: 'pivi-mcp-type-fields' });
    this.renderTypeFields();

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.enabled'))
      .setDesc(t('settings.mcp.modal.enabledDesc'))
      .addToggle((toggle) => {
        toggle.setValue(this.enabled);
        toggle.onChange((value) => {
          this.enabled = value;
        });
      });

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.contextSaving'))
      .setDesc(t('settings.mcp.modal.contextSavingDesc'))
      .addToggle((toggle) => {
        toggle.setValue(this.contextSaving);
        toggle.onChange((value) => {
          this.contextSaving = value;
        });
      });

    const buttonContainer = contentEl.createDiv({ cls: 'pivi-mcp-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('common.cancel'),
      cls: 'pivi-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingServer ? t('common.update') : t('common.add'),
      cls: 'pivi-save-btn mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private renderTypeFields() {
    if (!this.typeFieldsEl) return;
    this.typeFieldsEl.empty();

    if (this.serverType === 'stdio') {
      this.renderStdioFields();
    } else {
      this.renderUrlFields();
    }
  }

  private renderStdioFields() {
    if (!this.typeFieldsEl) return;

    const cmdSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.command'))
      .setDesc(t('settings.mcp.modal.commandDesc'));
    cmdSetting.settingEl.addClass('pivi-mcp-cmd-setting');

    const cmdTextarea = cmdSetting.controlEl.createEl('textarea', {
      cls: 'pivi-mcp-cmd-textarea',
    });
    cmdTextarea.value = this.command;
    cmdTextarea.placeholder = 'Docker exec -i mcp-server python -m src.server';
    cmdTextarea.rows = 2;
    cmdTextarea.addEventListener('input', () => {
      this.command = cmdTextarea.value;
    });

    const envSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.env'))
      .setDesc(t('settings.mcp.modal.envDesc'));
    envSetting.settingEl.addClass('pivi-mcp-env-setting');

    const envTextarea = envSetting.controlEl.createEl('textarea', {
      cls: 'pivi-mcp-env-textarea',
    });
    envTextarea.value = this.env;
    envTextarea.placeholder = 'API_key=your-key';
    envTextarea.rows = 2;
    envTextarea.addEventListener('input', () => {
      this.env = envTextarea.value;
    });
  }

  private renderUrlFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.url'))
      .setDesc(
        this.serverType === 'sse'
          ? t('settings.mcp.modal.urlDescSse')
          : t('settings.mcp.modal.urlDescHttp'),
      )
      .addText((text) => {
        text.setValue(this.url);
        text.setPlaceholder(t('settings.mcp.modal.urlPlaceholder'));
        text.onChange((value) => {
          this.url = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    const headersSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.headersName'))
      .setDesc(t('settings.mcp.modal.headers'));
    headersSetting.settingEl.addClass('pivi-mcp-env-setting');

    const headersTextarea = headersSetting.controlEl.createEl('textarea', {
      cls: 'pivi-mcp-env-textarea',
    });
    headersTextarea.value = this.headers;
    headersTextarea.placeholder = 'Authorization=bearer token\ncontent-type=application/JSON';
    headersTextarea.rows = 3;
    headersTextarea.addEventListener('input', () => {
      this.headers = headersTextarea.value;
    });

    this.renderAuthFields();
  }

  private renderAuthFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.authHeading'))
      .setDesc(t('settings.mcp.modal.oauthVaultNote'))
      .addDropdown((dropdown) => {
        dropdown.addOption('auto', t('settings.mcp.modal.authAuto'));
        dropdown.addOption('oauth', t('settings.mcp.modal.authOauth'));
        dropdown.addOption('bearer', t('settings.mcp.modal.authBearer'));
        dropdown.addOption('none', t('settings.mcp.modal.authNone'));
        dropdown.setValue(this.authMode);
        dropdown.onChange((value) => {
          this.authMode = value as typeof this.authMode;
          this.renderTypeFields();
        });
      });

    if (this.authMode === 'oauth') {
      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.oauthGrant'))
        .addDropdown((dropdown) => {
          dropdown.addOption('authorization_code', t('settings.mcp.modal.grantAuthCode'));
          dropdown.addOption('client_credentials', t('settings.mcp.modal.grantClientCredentials'));
          dropdown.setValue(this.oauthGrantType);
          dropdown.onChange((value) => {
            this.oauthGrantType = value as typeof this.oauthGrantType;
          });
        });

      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.clientId'))
        .setDesc(t('settings.mcp.modal.clientIdDesc'))
        .addText((text) => {
          text.setValue(this.oauthClientId);
          text.onChange((value) => {
            this.oauthClientId = value;
          });
        });

      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.clientSecret'))
        .setDesc(t('settings.mcp.modal.clientSecretDesc'))
        .addText((text) => {
          text.setValue(this.oauthClientSecret);
          text.inputEl.type = 'password';
          text.onChange((value) => {
            this.oauthClientSecret = value;
          });
        });

      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.scope'))
        .addText((text) => {
          text.setValue(this.oauthScope);
          text.onChange((value) => {
            this.oauthScope = value;
          });
        });
    }

    if (this.authMode === 'bearer') {
      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.bearerToken'))
        .setDesc(t('settings.mcp.modal.bearerTokenDesc'))
        .addText((text) => {
          text.setValue(this.bearerToken);
          text.inputEl.type = 'password';
          text.onChange((value) => {
            this.bearerToken = value;
          });
        });

      new Setting(this.typeFieldsEl)
        .setName(t('settings.mcp.modal.bearerTokenEnv'))
        .setDesc(t('settings.mcp.modal.bearerTokenEnvDesc'))
        .addText((text) => {
          text.setValue(this.bearerTokenEnv);
          text.onChange((value) => {
            this.bearerTokenEnv = value;
          });
        });
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    // !e.isComposing for IME support
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.save();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.close();
    }
  }

  private save() {
    const name = this.serverName.trim();
    if (!name) {
      new Notice(t('settings.mcp.modal.needName'));
      this.nameInputEl?.focus();
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      new Notice(t('settings.mcp.modal.serverNameInvalid'));
      this.nameInputEl?.focus();
      return;
    }

    let config: McpServerConfig;

    if (this.serverType === 'stdio') {
      const fullCommand = this.command.trim();
      if (!fullCommand) {
        new Notice(t('settings.mcp.modal.needCommand'));
        return;
      }

      const { cmd, args } = parseCommand(fullCommand);
      const stdioConfig: McpStdioServerConfig = { command: cmd };

      if (args.length > 0) {
        stdioConfig.args = args;
      }

      const env = this.parseEnvString(this.env);
      if (Object.keys(env).length > 0) {
        stdioConfig.env = env;
      }

      config = stdioConfig;
    } else {
      const url = this.url.trim();
      if (!url) {
        new Notice(t('settings.mcp.modal.needUrl'));
        return;
      }

      if (this.serverType === 'sse') {
        const sseConfig: McpSSEServerConfig = { type: 'sse', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          sseConfig.headers = headers;
        }
        config = sseConfig;
      } else {
        const httpConfig: McpHttpServerConfig = { type: 'http', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          httpConfig.headers = headers;
        }
        config = httpConfig;
      }
    }

    const server: ManagedMcpServer = {
      name,
      config,
      enabled: this.enabled,
      contextSaving: this.contextSaving,
      disabledTools: this.existingServer?.disabledTools,
    };

    if (this.serverType !== 'stdio') {
      if (this.authMode === 'none') {
        server.auth = 'none';
        server.oauth = false;
      } else if (this.authMode === 'bearer') {
        server.auth = 'bearer';
        const token = this.bearerToken.trim();
        const tokenEnv = this.bearerTokenEnv.trim();
        if (token) {
          server.bearerToken = token;
        }
        if (tokenEnv) {
          server.bearerTokenEnv = tokenEnv;
        }
      } else if (this.authMode === 'oauth') {
        server.auth = 'oauth';
        const oauth: McpOAuthConfig = {
          grantType: this.oauthGrantType,
        };
        const clientId = this.oauthClientId.trim();
        const clientSecret = this.oauthClientSecret.trim();
        const scope = this.oauthScope.trim();
        if (clientId) {
          oauth.clientId = clientId;
        }
        if (clientSecret) {
          oauth.clientSecret = clientSecret;
        }
        if (scope) {
          oauth.scope = scope;
        }
        server.oauth = oauth;
      }
    }

    this.onSave(server);
    this.close();
  }

  private parseEnvString(envStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!envStr.trim()) return result;

    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  private envRecordToString(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  onClose() {
    this.contentEl.empty();
  }
}
