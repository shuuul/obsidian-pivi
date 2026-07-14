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
  McpTool,
} from '@pivi/pivi-agent-core/mcp/types';
import { DEFAULT_MCP_SERVER, getMcpServerType, supportsMcpOAuth } from '@pivi/pivi-agent-core/mcp/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts } from '../ports';
import { McpServerCard } from './McpServerCard';

type McpPorts = SettingsComplexPorts['mcp'];

type Draft = {
  name: string;
  type: McpServerType;
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
    enabled: existing?.enabled ?? DEFAULT_MCP_SERVER.enabled,
    contextSaving: DEFAULT_MCP_SERVER.contextSaving,
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
  inline = false,
  onCancel,
  onSave,
}: {
  readonly server?: ManagedMcpServer;
  readonly initial?: ManagedMcpServer;
  readonly type?: McpServerType;
  readonly inline?: boolean;
  readonly onCancel?: () => void;
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
    <div
      className={inline ? 'pivi-mcp-inline-editor' : 'pivi-mcp-modal'}
      {...(inline ? {} : { role: 'dialog', 'aria-modal': true, 'aria-label': t('settings.mcp.modal.titleAdd') })}
    >
      {!inline ? <h2>{t('settings.mcp.modal.titleAdd')}</h2> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="pivi-mcp-editor-row pivi-mcp-editor-row-primary">
        <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
          <span>{t('settings.mcp.modal.serverName')}</span>
          <input value={draft.name} placeholder={t('settings.mcp.modal.serverNamePlaceholder')} onChange={(event) => update('name', event.target.value)} />
        </label>
      </div>
      {draft.type === 'stdio' ? (
        <>
          <div className="pivi-mcp-editor-row">
            <label className="pivi-mcp-editor-field pivi-mcp-editor-field-type">
              <span>{t('settings.mcp.modal.type')}</span>
              <select value={draft.type} onChange={(event) => update('type', event.target.value as McpServerType)}>
                <option value="stdio">{t('settings.mcp.modal.typeStdioOption')}</option>
                <option value="sse">{t('settings.mcp.modal.typeSseOption')}</option>
                <option value="http">{t('settings.mcp.modal.typeHttpOption')}</option>
              </select>
            </label>
            <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
              <span>{t('settings.mcp.modal.command')}</span>
              <input value={draft.command} onChange={(event) => update('command', event.target.value)} />
            </label>
          </div>
          <label className="pivi-mcp-editor-field pivi-mcp-editor-field-area">
            <span>{t('settings.mcp.modal.env')}</span>
            <textarea value={draft.env} onChange={(event) => update('env', event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="pivi-mcp-editor-row">
            <label className="pivi-mcp-editor-field pivi-mcp-editor-field-type">
              <span>{t('settings.mcp.modal.type')}</span>
              <select value={draft.type} onChange={(event) => update('type', event.target.value as McpServerType)}>
                <option value="stdio">{t('settings.mcp.modal.typeStdioOption')}</option>
                <option value="sse">{t('settings.mcp.modal.typeSseOption')}</option>
                <option value="http">{t('settings.mcp.modal.typeHttpOption')}</option>
              </select>
            </label>
            <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
              <span>{t('settings.mcp.modal.url')}</span>
              <input value={draft.url} placeholder={t('settings.mcp.modal.urlPlaceholder')} onChange={(event) => update('url', event.target.value)} />
            </label>
            <label className="pivi-mcp-editor-field pivi-mcp-editor-field-auth">
              <span>{t('settings.mcp.modal.authHeading')}</span>
              <select value={draft.auth} onChange={(event) => update('auth', event.target.value as Draft['auth'])}>
                <option value="auto">{t('settings.mcp.modal.authAuto')}</option>
                <option value="oauth">{t('settings.mcp.modal.authOauth')}</option>
                <option value="bearer">{t('settings.mcp.modal.authBearer')}</option>
                <option value="none">{t('settings.mcp.modal.authNone')}</option>
              </select>
            </label>
          </div>
          <label className="pivi-mcp-editor-field pivi-mcp-editor-field-area pivi-mcp-editor-field-headers">
            <span>{t('settings.mcp.modal.headersName')}</span>
            <textarea value={draft.headers} onChange={(event) => update('headers', event.target.value)} />
          </label>
          {draft.auth === 'oauth' ? (
            <div className="pivi-mcp-editor-row">
              <label className="pivi-mcp-editor-field">
                <span>{t('settings.mcp.modal.oauthGrant')}</span>
                <select value={draft.grantType} onChange={(event) => update('grantType', event.target.value as Draft['grantType'])}>
                  <option value="authorization_code">{t('settings.mcp.modal.grantAuthCode')}</option>
                  <option value="client_credentials">{t('settings.mcp.modal.grantClientCredentials')}</option>
                </select>
              </label>
              <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
                <span>{t('settings.mcp.modal.clientId')}</span>
                <input value={draft.clientId} onChange={(event) => update('clientId', event.target.value)} />
              </label>
              <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
                <span>{t('settings.mcp.modal.clientSecret')}</span>
                <input type="password" value={draft.clientSecret} onChange={(event) => update('clientSecret', event.target.value)} />
              </label>
              <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
                <span>{t('settings.mcp.modal.scope')}</span>
                <input value={draft.scope} onChange={(event) => update('scope', event.target.value)} />
              </label>
            </div>
          ) : null}
          {draft.auth === 'bearer' ? (
            <div className="pivi-mcp-editor-row">
              <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
                <span>{t('settings.mcp.modal.bearerToken')}</span>
                <input type="password" value={draft.bearerToken} onChange={(event) => update('bearerToken', event.target.value)} />
              </label>
              <label className="pivi-mcp-editor-field pivi-mcp-editor-field-grow">
                <span>{t('settings.mcp.modal.bearerTokenEnv')}</span>
                <input value={draft.bearerTokenEnv} onChange={(event) => update('bearerTokenEnv', event.target.value)} />
              </label>
            </div>
          ) : null}
        </>
      )}
      {!inline ? <button type="button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button> : null}
      <button type="button" disabled={busy} onClick={() => { void submit(); }}>
        {inline ? t('common.save') : t('common.add')}
      </button>
    </div>
  );
}

export function McpTab({ mcp }: { readonly mcp: McpPorts }) {
  const t = useT();
  const rootRef = useRef<HTMLElement | null>(null);
  const [servers, setServers] = useState<readonly ManagedMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ initial?: ManagedMcpServer; type?: McpServerType } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auth, setAuth] = useState<Record<string, McpAuthStatus | null>>({});
  const [toolsByServer, setToolsByServer] = useState<Record<string, readonly McpTool[]>>({});
  const [deleteCandidate, setDeleteCandidate] = useState<ManagedMcpServer | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [expandedServers, setExpandedServers] = useState<ReadonlySet<string>>(() => new Set());

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
        }).catch((cause) => {
          if (alive) setError(errorText(cause, t('settings.mcp.authFailed', { name: server.name })));
        });
      }
    }
    return () => { alive = false; };
  }, [mcp, servers, t]);

  useEffect(() => {
    let alive = true;
    const nextTools: Record<string, readonly McpTool[]> = Object.fromEntries(
      servers.map((server) => [server.name, []]),
    );
    setToolsByServer(nextTools);
    for (const server of servers) {
      if (!server.enabled) continue;
      void mcp.listTools(server.name).then((tools) => {
        if (!alive) return;
        setToolsByServer((current) => ({ ...current, [server.name]: tools }));
      }).catch(() => {
        // The selector retries unavailable servers; the settings card stays usable meanwhile.
      });
    }
    return () => { alive = false; };
  }, [mcp, servers]);

  useEffect(() => {
    const close = () => setAddOpen(false);
    const ownerDocument = rootRef.current?.ownerDocument;
    ownerDocument?.addEventListener('click', close);
    return () => ownerDocument?.removeEventListener('click', close);
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

  const save = async (server: ManagedMcpServer, existing?: ManagedMcpServer) => {
    const duplicate = servers.find((item) => item.name === server.name && item.name !== existing?.name);
    if (duplicate) throw new Error(t('settings.mcp.alreadyExists', { name: server.name }));
    const next = existing
      ? servers.map((item) => (item.name === existing.name ? server : item))
      : [...servers, server];
    await commit(next);
    if (existing && existing.name !== server.name) {
      setExpandedServers((current) => {
        const expanded = new Set(current);
        expanded.delete(existing.name);
        expanded.add(server.name);
        return expanded;
      });
    }
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

  const authenticate = async (server: ManagedMcpServer) => {
    setBusy(`auth:${server.name}`);
    setError('');
    try {
      await mcp.authenticate(server);
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.authFailed', { name: server.name })));
      setBusy(null);
      return;
    }
    try {
      await mcp.reload();
      await refresh();
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.saveReloadFailed')));
    } finally {
      setBusy(null);
    }
  };

  const logout = async (server: ManagedMcpServer) => {
    setBusy(`logout:${server.name}`);
    setError('');
    try {
      await mcp.logout(server.name);
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.authFailed', { name: server.name })));
      setBusy(null);
      return;
    }
    try {
      await mcp.reload();
      await refresh();
    } catch (cause) {
      setError(errorText(cause, t('settings.mcp.saveReloadFailed')));
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
        return (
          <McpServerCard
            key={server.name}
            server={server}
            expanded={expandedServers.has(server.name)}
            authStatus={auth[server.name]}
            selectorTools={toolsByServer[server.name] ?? []}
            busy={busy !== null}
            mcp={mcp}
            configEditor={(
              <ServerEditor
                server={server}
                inline
                onSave={(next) => save(next, server)}
              />
            )}
            onToggleExpanded={() => {
              setExpandedServers((current) => {
                const next = new Set(current);
                if (next.has(server.name)) next.delete(server.name);
                else next.add(server.name);
                return next;
              });
            }}
            onToggleEnabled={() => commit(servers.map((item) => (item.name === server.name ? { ...item, enabled: !item.enabled } : item)))}
            onRemove={() => setDeleteCandidate(server)}
            onAuthenticate={() => authenticate(server)}
            onLogout={() => logout(server)}
          />
        );
      })}
    </div>
  );

  return (
    <section ref={rootRef} className="pivi-mcp-container">
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
            <PlatformIcon name="plus" />
          </button>
          <div className={`pivi-mcp-add-dropdown${addOpen ? ' is-visible' : ''}`}>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); setEditor({ type: 'stdio' }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="terminal" /></span>
              <span>{t('settings.mcp.typeStdio')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); setEditor({ type: 'http' }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="globe" /></span>
              <span>{t('settings.mcp.typeHttp')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { setAddOpen(false); void importClipboard(); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="clipboard-paste" /></span>
              <span>{t('settings.mcp.importClipboard')}</span>
            </div>
          </div>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {content}
      {editor ? (
        <ServerEditor
          initial={editor.initial}
          type={editor.type}
          onCancel={() => setEditor(null)}
          onSave={(server) => save(server)}
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
