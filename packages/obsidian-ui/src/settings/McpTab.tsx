import { tryParseClipboardConfig } from '@pivi/pivi-agent-core/mcp/mcpConfigParser';
import { parseCommand } from '@pivi/pivi-agent-core/mcp/mcpUtils';
import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
  McpTestResult,
} from '@pivi/pivi-agent-core/mcp/types';
import { DEFAULT_MCP_SERVER, getMcpServerType, supportsMcpOAuth } from '@pivi/pivi-agent-core/mcp/types';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../i18n';
import { ObsidianIcon } from '../icons';
import type { SettingsComplexPorts } from '../ports';

type McpPorts = SettingsComplexPorts['mcp'];

type Draft = {
  name: string;
  type: McpServerType;
  enabled: boolean;
  contextSaving: boolean;
  command: string;
  env: string;
  url: string;
  headers: string;
  auth: 'auto' | 'oauth' | 'bearer' | 'none';
  grantType: 'authorization_code' | 'client_credentials';
  clientId: string;
  clientSecret: string;
  scope: string;
  bearerToken: string;
  bearerTokenEnv: string;
};

const namePattern = /^[a-zA-Z0-9._-]+$/;
const toLines = (record?: Record<string, string>) => Object.entries(record ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');

function fromLines(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    const index = line.indexOf('=');
    if (!line || line.startsWith('#') || index < 1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function draftFrom(server?: ManagedMcpServer, type: McpServerType = 'stdio'): Draft {
  const config = server?.config;
  const serverType = config ? getMcpServerType(config) : type;
  const remote = config && serverType !== 'stdio' ? config as McpSSEServerConfig | McpHttpServerConfig : undefined;
  const stdio = config && serverType === 'stdio' ? config as McpStdioServerConfig : undefined;
  const oauth = server?.oauth && typeof server.oauth === 'object' ? server.oauth : undefined;
  return {
    name: server?.name ?? '',
    type: serverType,
    enabled: server?.enabled ?? DEFAULT_MCP_SERVER.enabled,
    contextSaving: server?.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving,
    command: stdio ? [stdio.command, ...(stdio.args ?? [])].join(' ') : '',
    env: toLines(stdio?.env),
    url: remote?.url ?? '',
    headers: toLines(remote?.headers),
    auth: server?.auth === 'none' || server?.oauth === false
      ? 'none'
      : server?.auth === 'bearer'
        ? 'bearer'
        : server?.auth === 'oauth' || oauth
          ? 'oauth'
          : 'auto',
    grantType: oauth?.grantType ?? 'authorization_code',
    clientId: oauth?.clientId ?? '',
    clientSecret: oauth?.clientSecret ?? '',
    scope: oauth?.scope ?? '',
    bearerToken: server?.bearerToken ?? '',
    bearerTokenEnv: server?.bearerTokenEnv ?? '',
  };
}

function buildServer(draft: Draft, existing?: ManagedMcpServer): ManagedMcpServer | null {
  const name = draft.name.trim();
  if (!name || !namePattern.test(name)) return null;
  let config: McpServerConfig;
  if (draft.type === 'stdio') {
    const command = draft.command.trim();
    if (!command) return null;
    const parsed = parseCommand(command);
    const env = fromLines(draft.env);
    config = { command: parsed.cmd, ...(parsed.args.length ? { args: parsed.args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  } else {
    const url = draft.url.trim();
    if (!url) return null;
    const headers = fromLines(draft.headers);
    config = draft.type === 'sse'
      ? { type: 'sse', url, ...(Object.keys(headers).length ? { headers } : {}) }
      : { type: 'http', url, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  const server: ManagedMcpServer = {
    name,
    config,
    enabled: draft.enabled,
    contextSaving: draft.contextSaving,
    ...(existing?.disabledTools ? { disabledTools: existing.disabledTools } : {}),
  };
  if (draft.type !== 'stdio') {
    if (draft.auth === 'none') { server.auth = 'none'; server.oauth = false; }
    if (draft.auth === 'bearer') {
      server.auth = 'bearer';
      if (draft.bearerToken.trim()) server.bearerToken = draft.bearerToken.trim();
      if (draft.bearerTokenEnv.trim()) server.bearerTokenEnv = draft.bearerTokenEnv.trim();
    }
    if (draft.auth === 'oauth') {
      server.auth = 'oauth';
      server.oauth = {
        grantType: draft.grantType,
        ...(draft.clientId.trim() ? { clientId: draft.clientId.trim() } : {}),
        ...(draft.clientSecret.trim() ? { clientSecret: draft.clientSecret.trim() } : {}),
        ...(draft.scope.trim() ? { scope: draft.scope.trim() } : {}),
      };
    }
  }
  return server;
}

function ServerEditor({
  server,
  initial,
  type,
  onCancel,
  onSave,
}: {
  readonly server?: ManagedMcpServer;
  readonly initial?: ManagedMcpServer;
  readonly type?: McpServerType;
  readonly onCancel: () => void;
  readonly onSave: (server: ManagedMcpServer) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => draftFrom(server ?? initial, type));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const next = buildServer(draft, server);
    if (!next) {
      setError(!draft.name.trim()
        ? t('settings.mcp.modal.needName')
        : !namePattern.test(draft.name.trim())
          ? t('settings.mcp.modal.serverNameInvalid')
          : draft.type === 'stdio'
            ? t('settings.mcp.modal.needCommand')
            : t('settings.mcp.modal.needUrl'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(next);
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pivi-mcp-modal" role="dialog" aria-modal="true" aria-label={server ? t('settings.mcp.modal.titleEdit') : t('settings.mcp.modal.titleAdd')}>
      <h2>{server ? t('settings.mcp.modal.titleEdit') : t('settings.mcp.modal.titleAdd')}</h2>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        {t('settings.mcp.modal.serverName')}
        <input value={draft.name} placeholder={t('settings.mcp.modal.serverNamePlaceholder')} onChange={(event) => update('name', event.target.value)} />
      </label>
      <label>
        {t('settings.mcp.modal.type')}
        <select value={draft.type} onChange={(event) => update('type', event.target.value as McpServerType)}>
          <option value="stdio">{t('settings.mcp.modal.typeStdioOption')}</option>
          <option value="sse">{t('settings.mcp.modal.typeSseOption')}</option>
          <option value="http">{t('settings.mcp.modal.typeHttpOption')}</option>
        </select>
      </label>
      {draft.type === 'stdio' ? (
        <>
          <label>
            {t('settings.mcp.modal.command')}
            <textarea value={draft.command} onChange={(event) => update('command', event.target.value)} />
          </label>
          <label>
            {t('settings.mcp.modal.env')}
            <textarea value={draft.env} onChange={(event) => update('env', event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <label>
            {t('settings.mcp.modal.url')}
            <input value={draft.url} placeholder={t('settings.mcp.modal.urlPlaceholder')} onChange={(event) => update('url', event.target.value)} />
          </label>
          <label>
            {t('settings.mcp.modal.headersName')}
            <textarea value={draft.headers} onChange={(event) => update('headers', event.target.value)} />
          </label>
          <label>
            {t('settings.mcp.modal.authHeading')}
            <select value={draft.auth} onChange={(event) => update('auth', event.target.value as Draft['auth'])}>
              <option value="auto">{t('settings.mcp.modal.authAuto')}</option>
              <option value="oauth">{t('settings.mcp.modal.authOauth')}</option>
              <option value="bearer">{t('settings.mcp.modal.authBearer')}</option>
              <option value="none">{t('settings.mcp.modal.authNone')}</option>
            </select>
          </label>
          {draft.auth === 'oauth' ? (
            <>
              <label>
                {t('settings.mcp.modal.oauthGrant')}
                <select value={draft.grantType} onChange={(event) => update('grantType', event.target.value as Draft['grantType'])}>
                  <option value="authorization_code">{t('settings.mcp.modal.grantAuthCode')}</option>
                  <option value="client_credentials">{t('settings.mcp.modal.grantClientCredentials')}</option>
                </select>
              </label>
              <label>
                {t('settings.mcp.modal.clientId')}
                <input value={draft.clientId} onChange={(event) => update('clientId', event.target.value)} />
              </label>
              <label>
                {t('settings.mcp.modal.clientSecret')}
                <input type="password" value={draft.clientSecret} onChange={(event) => update('clientSecret', event.target.value)} />
              </label>
              <label>
                {t('settings.mcp.modal.scope')}
                <input value={draft.scope} onChange={(event) => update('scope', event.target.value)} />
              </label>
            </>
          ) : null}
          {draft.auth === 'bearer' ? (
            <>
              <label>
                {t('settings.mcp.modal.bearerToken')}
                <input type="password" value={draft.bearerToken} onChange={(event) => update('bearerToken', event.target.value)} />
              </label>
              <label>
                {t('settings.mcp.modal.bearerTokenEnv')}
                <input value={draft.bearerTokenEnv} onChange={(event) => update('bearerTokenEnv', event.target.value)} />
              </label>
            </>
          ) : null}
        </>
      )}
      <label>
        {t('settings.mcp.modal.enabled')}
        <input type="checkbox" checked={draft.enabled} onChange={(event) => update('enabled', event.target.checked)} />
      </label>
      <label>
        {t('settings.mcp.modal.contextSaving')}
        <input type="checkbox" checked={draft.contextSaving} onChange={(event) => update('contextSaving', event.target.checked)} />
      </label>
      <button type="button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" disabled={busy} onClick={() => { void submit(); }}>{server ? t('common.update') : t('common.add')}</button>
    </div>
  );
}

function TestDialog({
  result,
  disabledTools,
  onToggle,
  onClose,
}: {
  readonly result: McpTestResult | null;
  readonly disabledTools: readonly string[];
  readonly onToggle: (names: string[]) => Promise<void>;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [disabled, setDisabled] = useState(() => new Set(disabledTools));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tools = result?.tools ?? [];
  const change = async (next: Set<string>) => {
    const previous = disabled;
    setDisabled(next);
    setBusy(true);
    setError('');
    try {
      await onToggle([...next]);
    } catch (cause) {
      setDisabled(previous);
      setError(errorText(cause, t('settings.mcp.test.toggleFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={t('settings.mcp.test.titleVerify', { name: result?.serverName ?? '' })} className="pivi-mcp-test-modal">
      {result === null ? <p>{t('settings.mcp.test.connecting')}</p> : (
        <>
          {error ? <p role="alert">{error}</p> : null}
          <p>{result.success ? t('settings.mcp.test.connected') : t('settings.mcp.test.failed')}</p>
          {result.error ? <p>{result.error}</p> : null}
          {tools.length ? (
            <>
              <p>{t('settings.mcp.test.availableTools', { count: tools.length })}</p>
              <button type="button" disabled={busy} onClick={() => { void change(disabled.size ? new Set() : new Set(tools.map((tool) => tool.name))); }}>
                {disabled.size ? t('settings.mcp.test.enableAll') : t('settings.mcp.test.disableAll')}
              </button>
              {tools.map((tool) => (
                <label key={tool.name}>
                  <input
                    type="checkbox"
                    checked={!disabled.has(tool.name)}
                    disabled={busy}
                    onChange={(event) => {
                      const next = new Set(disabled);
                      if (event.target.checked) next.delete(tool.name);
                      else next.add(tool.name);
                      void change(next);
                    }}
                  />
                  {tool.name}
                  {tool.description ? ` — ${tool.description}` : ''}
                </label>
              ))}
            </>
          ) : result.success ? <p>{t('settings.mcp.test.noTools')}</p> : null}
        </>
      )}
      <button type="button" onClick={onClose}>{t('common.close')}</button>
    </div>
  );
}

export function McpTab({ mcp }: { readonly mcp: McpPorts }) {
  const t = useT();
  const [servers, setServers] = useState<readonly ManagedMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ server?: ManagedMcpServer; initial?: ManagedMcpServer; type?: McpServerType } | null>(null);
  const [test, setTest] = useState<{ server: ManagedMcpServer; result: McpTestResult | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auth, setAuth] = useState<Record<string, McpAuthStatus | null>>({});
  const [deleteCandidate, setDeleteCandidate] = useState<ManagedMcpServer | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setServers(await mcp.load());
      setError('');
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.saveFailed')));
    } finally {
      setLoading(false);
    }
  }, [mcp, t]);

  useEffect(() => {
    let alive = true;
    void mcp.load()
      .then((next) => {
        if (alive) {
          setServers(next);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(errorText(cause, t('settings.mcp.saveFailed')));
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, [mcp, t]);

  useEffect(() => {
    let alive = true;
    for (const server of servers) {
      if (supportsMcpOAuth(server)) {
        void mcp.getAuthStatus(server).then((status) => {
          if (alive) setAuth((current) => ({ ...current, [server.name]: status }));
        }).catch(() => undefined);
      }
    }
    return () => { alive = false; };
  }, [mcp, servers]);

  useEffect(() => {
    const close = () => setAddOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const commit = async (next: readonly ManagedMcpServer[]) => {
    await mcp.save(next);
    try {
      await mcp.reload();
    } catch {
      setError(t('settings.mcp.saveReloadFailed'));
    }
    setServers(next);
  };

  const save = async (server: ManagedMcpServer) => {
    const duplicate = servers.find((item) => item.name === server.name && item.name !== editor?.server?.name);
    if (duplicate) throw new Error(t('settings.mcp.alreadyExists', { name: server.name }));
    const next = editor?.server
      ? servers.map((item) => (item.name === editor.server?.name ? server : item))
      : [...servers, server];
    await commit(next);
    setEditor(null);
  };

  const importClipboard = async () => {
    setBusy('import');
    try {
      const parsed = tryParseClipboardConfig(await navigator.clipboard.readText());
      if (!parsed?.servers.length) throw new Error(t('settings.mcp.noValidConfig'));
      if (parsed.needsName || parsed.servers.length === 1) {
        const first = parsed.servers[0];
        if (first) {
          setEditor({
            initial: {
              name: first.name,
              config: first.config,
              enabled: DEFAULT_MCP_SERVER.enabled,
              contextSaving: DEFAULT_MCP_SERVER.contextSaving,
            },
          });
        }
        return;
      }
      const names = new Set(servers.map((server) => server.name));
      const added = parsed.servers
        .filter((server) => namePattern.test(server.name.trim()) && !names.has(server.name.trim()))
        .map((server) => ({
          name: server.name.trim(),
          config: server.config,
          enabled: DEFAULT_MCP_SERVER.enabled,
          contextSaving: DEFAULT_MCP_SERVER.contextSaving,
        }));
      if (!added.length) throw new Error(t('settings.mcp.importedNone'));
      await commit([...servers, ...added]);
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.clipboardReadFailed')));
    } finally {
      setBusy(null);
    }
  };

  const preview = (server: ManagedMcpServer) => {
    const config = server.config as { command?: string; args?: string[]; url?: string };
    return server.description ?? (config.url ?? [config.command, ...(config.args ?? [])].filter(Boolean).join(' '));
  };

  const testServer = async (server: ManagedMcpServer) => {
    setTest({ server, result: null });
    try {
      const result = await mcp.test(server);
      setTest((current) => (current?.server.name === server.name ? { ...current, result } : current));
    } catch (cause) {
      setTest((current) => (current?.server.name === server.name
        ? { ...current, result: { success: false, tools: [], error: errorText(cause, t('settings.mcp.verifyFailed')) } }
        : current));
    }
  };

  const toggleTools = async (server: ManagedMcpServer, disabledTools: string[]) => {
    await commit(servers.map((item) => (item.name === server.name
      ? { ...item, disabledTools: disabledTools.length ? disabledTools : undefined }
      : item)));
  };

  const authenticate = async (server: ManagedMcpServer) => {
    setBusy(`auth:${server.name}`);
    try {
      await mcp.authenticate(server);
      await mcp.reload();
      await refresh();
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.authFailed', { name: server.name })));
    } finally {
      setBusy(null);
    }
  };

  const logout = async (server: ManagedMcpServer) => {
    setBusy(`logout:${server.name}`);
    try {
      await mcp.logout(server.name);
      await mcp.reload();
      await refresh();
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.authFailed', { name: server.name })));
    } finally {
      setBusy(null);
    }
  };

  const content = loading ? (
    <p>{t('settings.mcp.test.connecting')}</p>
  ) : servers.length === 0 ? (
    <div className="pivi-mcp-empty">{t('settings.mcp.empty')}</div>
  ) : (
    <div className="pivi-mcp-list">
      {servers.map((server) => {
        const serverType = getMcpServerType(server.config);
        const authStatus = auth[server.name];
        return (
          <div className={`pivi-mcp-item${!server.enabled ? ' pivi-mcp-item-disabled' : ''}`} key={server.name}>
            <div className={`pivi-mcp-status ${server.enabled ? 'pivi-mcp-status-enabled' : 'pivi-mcp-status-disabled'}`} />
            <div className="pivi-mcp-info">
              <div className="pivi-mcp-name-row">
                <span className="pivi-mcp-name">{server.name}</span>
                <span className="pivi-mcp-type-badge">{serverType}</span>
                {server.contextSaving ? (
                  <span className="pivi-mcp-context-saving-badge" title={t('settings.mcp.contextSavingTitle', { name: server.name })}>@</span>
                ) : null}
                {authStatus === 'authenticated' ? (
                  <span className="pivi-mcp-type-badge" title={t('settings.mcp.oauthAuthenticated')}>{t('settings.mcp.oauthBadge')}</span>
                ) : null}
                {authStatus === 'expired' ? (
                  <span className="pivi-mcp-type-badge" title={t('settings.mcp.oauthExpiredTitle')}>{t('settings.mcp.oauthExpiredBadge')}</span>
                ) : null}
              </div>
              <div className="pivi-mcp-preview">{preview(server)}</div>
            </div>
            <div className="pivi-mcp-actions">
              {supportsMcpOAuth(server) ? (
                <>
                  <button type="button" className="pivi-mcp-action-btn" disabled={busy !== null} aria-label={t('settings.mcp.authOauth')} onClick={() => { void authenticate(server); }}>
                    <ObsidianIcon name="key" />
                  </button>
                  <button type="button" className="pivi-mcp-action-btn" disabled={busy !== null} aria-label={t('settings.mcp.clearOauth')} onClick={() => { void logout(server); }}>
                    <ObsidianIcon name="log-out" />
                  </button>
                </>
              ) : null}
              <button type="button" className="pivi-mcp-action-btn" aria-label={t('settings.mcp.verifyTools')} onClick={() => { void testServer(server); }}>
                <ObsidianIcon name="zap" />
              </button>
              <button
                type="button"
                className="pivi-mcp-action-btn"
                disabled={busy !== null}
                aria-label={server.enabled ? t('common.disable') : t('common.enable')}
                onClick={() => { void commit(servers.map((item) => (item.name === server.name ? { ...item, enabled: !item.enabled } : item))); }}
              >
                <ObsidianIcon name={server.enabled ? 'toggle-right' : 'toggle-left'} />
              </button>
              <button type="button" className="pivi-mcp-action-btn" aria-label={t('common.edit')} onClick={() => setEditor({ server })}>
                <ObsidianIcon name="pencil" />
              </button>
              <button type="button" className="pivi-mcp-action-btn pivi-mcp-delete-btn" aria-label={t('common.delete')} onClick={() => { setDeleteCandidate(server); }}>
                <ObsidianIcon name="trash-2" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section className="pivi-mcp-container">
      <header className="pivi-mcp-header">
        <span className="pivi-mcp-label">{t('settings.mcp.heading')}</span>
        <div className="pivi-mcp-add-container">
          <button
            type="button"
            className="pivi-settings-action-btn"
            aria-label={t('settings.mcp.add')}
            aria-expanded={addOpen}
            onClick={(event) => { event.stopPropagation(); setAddOpen((open) => !open); }}
          >
            <ObsidianIcon name="plus" />
          </button>
          <div className={`pivi-mcp-add-dropdown${addOpen ? ' is-visible' : ''}`}>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); setEditor({ type: 'stdio' }); }}>
              <span className="pivi-mcp-add-option-icon"><ObsidianIcon name="terminal" /></span>
              <span>{t('settings.mcp.typeStdio')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); setEditor({ type: 'http' }); }}>
              <span className="pivi-mcp-add-option-icon"><ObsidianIcon name="globe" /></span>
              <span>{t('settings.mcp.typeHttp')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); void importClipboard(); }}>
              <span className="pivi-mcp-add-option-icon"><ObsidianIcon name="clipboard-paste" /></span>
              <span>{t('settings.mcp.importClipboard')}</span>
            </div>
          </div>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {content}
      {editor ? (
        <ServerEditor
          server={editor.server}
          initial={editor.initial}
          type={editor.type}
          onCancel={() => setEditor(null)}
          onSave={save}
        />
      ) : null}
      {test ? (
        <TestDialog
          result={test.result}
          disabledTools={test.server.disabledTools ?? []}
          onToggle={(names) => toggleTools(test.server, names)}
          onClose={() => setTest(null)}
        />
      ) : null}
      {deleteCandidate ? (
        <div role="dialog" aria-modal="true" aria-label={t('settings.mcp.deleteConfirm', { name: deleteCandidate.name })}>
          <p>{t('settings.mcp.deleteConfirm', { name: deleteCandidate.name })}</p>
          <button type="button" onClick={() => setDeleteCandidate(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            onClick={() => { void commit(servers.filter((item) => item.name !== deleteCandidate.name)).then(() => setDeleteCandidate(null)); }}
          >
            {t('common.delete')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
