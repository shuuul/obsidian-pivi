import { tryParseClipboardConfig } from '@pivi/pivi-agent-core/mcp/mcpConfigParser';
import {
  formatMcpArgsLines,
  parseMcpArgsLines,
} from '@pivi/pivi-agent-core/mcp/mcpUtils';
import {
  assertValidMcpServerName,
  isValidMcpServerName,
  MCP_SERVER_NAME_PATTERN,
  McpValidationError,
  validateMcpRemoteUrl,
} from '@pivi/pivi-agent-core/mcp/mcpValidation';
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
import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { TFunction } from '../../i18n';
import { useT } from '../../i18n';
import type { SettingsComplexPorts, SettingsFeedbackPort } from '../../ports';

export type McpPorts = SettingsComplexPorts['mcp'];

export type McpDraft = {
  name: string;
  type: McpServerType;
  executable: string;
  argsText: string;
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

export { MCP_SERVER_NAME_PATTERN };

export const parseMcpArgsText = parseMcpArgsLines;
export const formatMcpArgsText = formatMcpArgsLines;

export function mcpValidationMessage(
  error: unknown,
  t: TFunction,
  fallback: string,
): string {
  if (error instanceof McpValidationError) {
    switch (error.code) {
      case 'serverNameRequired':
        return t('settings.mcp.modal.needName');
      case 'serverNameInvalid':
        return t('settings.mcp.modal.serverNameInvalid');
      case 'serverNameReserved':
        return t('settings.mcp.modal.serverNameReserved');
      case 'urlRequired':
        return t('settings.mcp.modal.needUrl');
      case 'urlInvalid':
        return t('settings.mcp.modal.urlInvalid');
      case 'urlScheme':
        return t('settings.mcp.modal.urlScheme');
      case 'urlPlainHttp':
        return t('settings.mcp.modal.urlPlainHttp');
      case 'commandRequired':
        return t('settings.mcp.modal.needCommand');
      default:
        return error.message;
    }
  }
  return mcpErrorText(error, fallback);
}

export const mcpErrorText = (error: unknown, fallback: string) =>
  (error instanceof Error && error.message ? error.message : fallback);

export const mcpDraftToLines = (record?: Record<string, string>) =>
  Object.entries(record ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');

export function mcpDraftFromLines(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    const index = line.indexOf('=');
    if (!line || line.startsWith('#') || index < 1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

export function mcpDraftFrom(server?: ManagedMcpServer, type: McpServerType = 'stdio'): McpDraft {
  const config = server?.config;
  const serverType = config ? getMcpServerType(config) : type;
  const remote = config && serverType !== 'stdio' ? config as McpSSEServerConfig | McpHttpServerConfig : undefined;
  const stdio = config && serverType === 'stdio' ? config as McpStdioServerConfig : undefined;
  const oauth = server?.oauth && typeof server.oauth === 'object' ? server.oauth : undefined;
  return {
    name: server?.name ?? '',
    type: serverType,
    executable: stdio?.command ?? '',
    argsText: formatMcpArgsText(stdio?.args),
    env: mcpDraftToLines(stdio?.env),
    url: remote?.url ?? '',
    headers: mcpDraftToLines(remote?.headers),
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

export function buildMcpServer(draft: McpDraft, existing?: ManagedMcpServer): ManagedMcpServer {
  const name = assertValidMcpServerName(draft.name);
  let config: McpServerConfig;
  if (draft.type === 'stdio') {
    const command = draft.executable.trim();
    if (!command) {
      throw new McpValidationError('commandRequired', 'MCP stdio executable is required');
    }
    const args = parseMcpArgsText(draft.argsText);
    const env = mcpDraftFromLines(draft.env);
    config = {
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  } else {
    const url = validateMcpRemoteUrl(draft.url);
    const headers = mcpDraftFromLines(draft.headers);
    config = draft.type === 'sse'
      ? { type: 'sse', url, ...(Object.keys(headers).length ? { headers } : {}) }
      : { type: 'http', url, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  const server: ManagedMcpServer = {
    name,
    config,
    enabled: existing?.enabled ?? DEFAULT_MCP_SERVER.enabled,
    contextSaving: existing?.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving,
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

type McpSectionState = {
  servers: readonly ManagedMcpServer[];
  loading: boolean;
  error: string;
  editor: { initial?: ManagedMcpServer; type?: McpServerType } | null;
  busy: string | null;
  auth: Record<string, McpAuthStatus | null>;
  toolsByServer: Record<string, readonly McpTool[]>;
  deleteCandidate: ManagedMcpServer | null;
  importDraft: string | null;
  addOpen: boolean;
  expandedServers: ReadonlySet<string>;
};

type McpSectionAction =
  | { type: 'set_loading'; loading: boolean }
  | { type: 'set_servers'; servers: readonly ManagedMcpServer[] }
  | { type: 'set_error'; error: string }
  | { type: 'set_editor'; editor: McpSectionState['editor'] }
  | { type: 'set_busy'; busy: string | null }
  | { type: 'set_auth'; name: string; status: McpAuthStatus | null }
  | { type: 'set_tools'; name: string; tools: readonly McpTool[] }
  | { type: 'reset_tools'; servers: readonly ManagedMcpServer[] }
  | { type: 'set_delete_candidate'; server: ManagedMcpServer | null }
  | { type: 'set_import_draft'; draft: string | null }
  | { type: 'toggle_add_open' }
  | { type: 'set_add_open'; open: boolean }
  | { type: 'toggle_expanded'; name: string }
  | { type: 'rename_expanded'; from: string; to: string };

const initialMcpSectionState: McpSectionState = {
  servers: [],
  loading: true,
  error: '',
  editor: null,
  busy: null,
  auth: {},
  toolsByServer: {},
  deleteCandidate: null,
  importDraft: null,
  addOpen: false,
  expandedServers: new Set(),
};

function mcpSectionReducer(state: McpSectionState, action: McpSectionAction): McpSectionState {
  switch (action.type) {
    case 'set_loading':
      return { ...state, loading: action.loading };
    case 'set_servers':
      return { ...state, servers: action.servers };
    case 'set_error':
      return { ...state, error: action.error };
    case 'set_editor':
      return { ...state, editor: action.editor };
    case 'set_busy':
      return { ...state, busy: action.busy };
    case 'set_auth':
      return { ...state, auth: { ...state.auth, [action.name]: action.status } };
    case 'set_tools':
      return { ...state, toolsByServer: { ...state.toolsByServer, [action.name]: action.tools } };
    case 'reset_tools':
      return {
        ...state,
        toolsByServer: Object.fromEntries(action.servers.map((server) => [server.name, []])),
      };
    case 'set_delete_candidate':
      return { ...state, deleteCandidate: action.server };
    case 'set_import_draft':
      return { ...state, importDraft: action.draft };
    case 'toggle_add_open':
      return { ...state, addOpen: !state.addOpen };
    case 'set_add_open':
      return { ...state, addOpen: action.open };
    case 'toggle_expanded': {
      const expandedServers = new Set(state.expandedServers);
      if (expandedServers.has(action.name)) expandedServers.delete(action.name);
      else expandedServers.add(action.name);
      return { ...state, expandedServers };
    }
    case 'rename_expanded': {
      const expandedServers = new Set(state.expandedServers);
      expandedServers.delete(action.from);
      expandedServers.add(action.to);
      return { ...state, expandedServers };
    }
    default:
      return state;
  }
}

export function useMcpSectionState(mcp: McpPorts, feedback: SettingsFeedbackPort) {
  const t = useT();
  const rootRef = useRef<HTMLElement | null>(null);
  const [state, dispatch] = useReducer(mcpSectionReducer, initialMcpSectionState);

  useEffect(() => {
    let alive = true;
    void mcp.load()
      .then((next) => {
        if (alive) {
          dispatch({ type: 'set_servers', servers: next });
          dispatch({ type: 'set_loading', loading: false });
        }
      })
      .catch((cause) => {
        if (alive) {
          dispatch({ type: 'set_error', error: mcpErrorText(cause, t('settings.mcp.saveFailed')) });
          dispatch({ type: 'set_loading', loading: false });
        }
      });
    return () => { alive = false; };
  }, [mcp, t]);

  useEffect(() => {
    let alive = true;
    for (const server of state.servers) {
      if (supportsMcpOAuth(server)) {
        void mcp.getAuthStatus(server).then((status) => {
          if (alive) dispatch({ type: 'set_auth', name: server.name, status });
        }).catch((cause) => {
          if (alive) feedback.notify(mcpErrorText(cause, t('settings.mcp.authFailed', { name: server.name })));
        });
      }
    }
    return () => { alive = false; };
  }, [feedback, mcp, state.servers, t]);

  useEffect(() => {
    let alive = true;
    dispatch({ type: 'reset_tools', servers: state.servers });
    for (const server of state.servers) {
      if (!server.enabled) continue;
      void mcp.listTools(server.name).then((tools) => {
        if (!alive) return;
        dispatch({ type: 'set_tools', name: server.name, tools });
      }).catch(() => {
        // The selector retries unavailable servers; the settings card stays usable meanwhile.
      });
    }
    return () => { alive = false; };
  }, [mcp, state.servers]);

  useEffect(() => {
    const close = () => dispatch({ type: 'set_add_open', open: false });
    const ownerDocument = rootRef.current?.ownerDocument;
    ownerDocument?.addEventListener('click', close);
    return () => ownerDocument?.removeEventListener('click', close);
  }, []);

  const commit = useCallback(async (next: readonly ManagedMcpServer[]) => {
    await mcp.save(next);
    dispatch({ type: 'set_servers', servers: next });
  }, [mcp]);

  const save = useCallback(async (server: ManagedMcpServer, existing?: ManagedMcpServer) => {
    const duplicate = state.servers.find((item) => item.name === server.name && item.name !== existing?.name);
    if (duplicate) throw new Error(t('settings.mcp.alreadyExists', { name: server.name }));
    const next = existing
      ? state.servers.map((item) => (item.name === existing.name ? server : item))
      : [...state.servers, server];
    await commit(next);
    if (existing && existing.name !== server.name) {
      dispatch({ type: 'rename_expanded', from: existing.name, to: server.name });
    }
    dispatch({ type: 'set_editor', editor: null });
  }, [commit, state.servers, t]);

  const importJson = useCallback(async (text: string) => {
    dispatch({ type: 'set_busy', busy: 'import' });
    dispatch({ type: 'set_error', error: '' });
    try {
      const parsed = tryParseClipboardConfig(text);
      if (!parsed?.servers.length) throw new Error(t('settings.mcp.noValidConfig'));
      if (parsed.needsName || parsed.servers.length === 1) {
        const first = parsed.servers[0];
        if (first) {
          dispatch({ type: 'set_import_draft', draft: null });
          dispatch({
            type: 'set_editor',
            editor: {
              initial: {
                name: first.name,
                config: first.config,
                enabled: DEFAULT_MCP_SERVER.enabled,
                contextSaving: DEFAULT_MCP_SERVER.contextSaving,
              },
            },
          });
        }
        return;
      }
      const names = new Set(state.servers.map((server) => server.name));
      const added = parsed.servers
        .filter((server) => isValidMcpServerName(server.name.trim()) && !names.has(server.name.trim()))
        .map((server) => ({
          name: server.name.trim(),
          config: server.config,
          enabled: DEFAULT_MCP_SERVER.enabled,
          contextSaving: DEFAULT_MCP_SERVER.contextSaving,
        }));
      if (!added.length) throw new Error(t('settings.mcp.importedNone'));
      await commit([...state.servers, ...added]);
      dispatch({ type: 'set_import_draft', draft: null });
    } catch (cause) {
      dispatch({ type: 'set_error', error: mcpErrorText(cause, t('settings.mcp.importFailed')) });
    } finally {
      dispatch({ type: 'set_busy', busy: null });
    }
  }, [commit, state.servers, t]);

  const connect = useCallback(async (
    server: ManagedMcpServer,
    existing: ManagedMcpServer,
  ) => {
    dispatch({ type: 'set_busy', busy: `connect:${existing.name}` });
    dispatch({ type: 'set_error', error: '' });
    try {
      await save(server, existing);
      const { authStatus, result } = await mcp.connect(server);
      dispatch({ type: 'set_auth', name: server.name, status: authStatus });
      if (result.success) dispatch({ type: 'set_tools', name: server.name, tools: result.tools });
      return result;
    } catch (cause) {
      throw new Error(mcpErrorText(cause, t('settings.mcp.authFailed', { name: server.name })));
    } finally {
      dispatch({ type: 'set_busy', busy: null });
    }
  }, [mcp, save, t]);

  const logout = useCallback(async (server: ManagedMcpServer) => {
    dispatch({ type: 'set_busy', busy: `logout:${server.name}` });
    dispatch({ type: 'set_error', error: '' });
    try {
      await mcp.logout(server.name);
    } catch (cause) {
      dispatch({ type: 'set_busy', busy: null });
      throw new Error(mcpErrorText(cause, t('settings.mcp.authFailed', { name: server.name })));
    }
    dispatch({ type: 'set_auth', name: server.name, status: 'not_authenticated' });
    dispatch({ type: 'set_busy', busy: null });
  }, [mcp, t]);

  return {
    rootRef,
    state,
    dispatch,
    commit,
    save,
    importJson,
    connect,
    logout,
  };
}
