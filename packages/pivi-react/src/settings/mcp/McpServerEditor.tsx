import type { ManagedMcpServer, McpServerType } from '@pivi/pivi-agent-core/mcp/types';
import { useState } from 'react';

import { useT } from '../../i18n';
import {
  buildMcpServer,
  type McpDraft,
  mcpDraftFrom,
  mcpErrorText,
} from './useMcpTabState';

export function McpServerEditor({
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
  const [draft, setDraft] = useState(() => mcpDraftFrom(server ?? initial, type));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const next = buildMcpServer(draft, server);
    if (!next) {
      setError(!draft.name.trim()
        ? t('settings.mcp.modal.needName')
        : !/^[a-zA-Z0-9._-]+$/.test(draft.name.trim())
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
      setError(mcpErrorText(cause, t('settings.mcp.saveFailed')));
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
              <select value={draft.auth} onChange={(event) => update('auth', event.target.value as McpDraft['auth'])}>
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
                <select value={draft.grantType} onChange={(event) => update('grantType', event.target.value as McpDraft['grantType'])}>
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
