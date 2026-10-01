import type { ManagedMcpServer, McpServerType } from '@pivi/agent/mcp/types';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useT } from '../../i18n';
import type { SettingsFeedbackMessage } from '../../ports';
import { Select, SettingRow, SettingsFeedback } from '../primitives';
import {
  buildMcpServer,
  type McpDraft,
  mcpDraftFrom,
  mcpValidationMessage,
} from './useMcpSectionState';

export interface McpServerEditorHandle {
  save: () => Promise<ManagedMcpServer | null>;
}

export const McpServerEditor = forwardRef<McpServerEditorHandle, {
  readonly server?: ManagedMcpServer;
  readonly initial?: ManagedMcpServer;
  readonly type?: McpServerType;
  readonly connecting?: boolean;
  readonly feedback?: SettingsFeedbackMessage;
  readonly onSave: (server: ManagedMcpServer) => Promise<unknown>;
}>(function McpServerEditor({
  server,
  initial,
  type,
  connecting = false,
  feedback,
  onSave,
}, ref) {
  const t = useT();
  const editorRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => mcpDraftFrom(server ?? initial, type));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError('');
  };

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const firstField = root.querySelector<HTMLElement>(
      'input.pivi-settings-control, textarea.pivi-settings-control, select.pivi-settings-control',
    );
    if (!firstField) return;
    firstField.focus();
    firstField.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const submit = async (): Promise<ManagedMcpServer | null> => {
    setBusy(true);
    setError('');
    try {
      const next = buildMcpServer(draft, server);
      const result = await onSave(next);
      return result !== false ? next : null;
    } catch (cause) {
      setError(mcpValidationMessage(cause, t, t('settings.mcp.saveFailed')));
      return null;
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({ save: submit }));

  const actions = (
    <div className="pivi-settings-action-group">
      {server ? (
        <button type="button" disabled={busy} onClick={() => { void submit(); }}>
          {connecting ? t('settings.mcp.test.connecting') : t('settings.mcp.refreshTools')}
        </button>
      ) : null}
      <SettingsFeedback feedback={error ? { kind: 'error', message: error } : feedback} />
    </div>
  );

  return (
    <div ref={editorRef} className="pivi-mcp-inline-editor">
      <div className="pivi-provider-endpoint-fields">
        <SettingRow name={t('settings.mcp.modal.serverName')}>
          <input
            className="pivi-settings-control pivi-settings-control--fill"
            value={draft.name}
            placeholder={t('settings.mcp.modal.serverNamePlaceholder')}
            onChange={(event) => update('name', event.target.value)}
          />
        </SettingRow>
        <SettingRow name={t('settings.mcp.modal.url')}>
          <input className="pivi-settings-control pivi-settings-control--fill" value={draft.url} placeholder={t('settings.mcp.modal.urlPlaceholder')} onChange={(event) => update('url', event.target.value)} />
        </SettingRow>
        <SettingRow name={t('settings.mcp.modal.authHeading')}>
          <Select label={t('settings.mcp.modal.authHeading')} value={draft.auth} onChange={(value) => update('auth', value as McpDraft['auth'])}>
            <option value="auto">{t('settings.mcp.modal.authAuto')}</option>
            <option value="oauth">{t('settings.mcp.modal.authOauth')}</option>
            <option value="bearer">{t('settings.mcp.modal.authBearer')}</option>
            <option value="none">{t('settings.mcp.modal.authNone')}</option>
          </Select>
        </SettingRow>
      </div>
      <SettingRow name={t('settings.mcp.modal.headersName')} description={t('settings.mcp.valueStorageHint')} stacked>
        <textarea className="pivi-settings-control pivi-settings-control--fill" value={draft.headers} onChange={(event) => update('headers', event.target.value)} />
      </SettingRow>
      {draft.auth === 'oauth' ? (
        <div className="pivi-provider-endpoint-fields">
          <SettingRow name={t('settings.mcp.modal.oauthGrant')}>
            <Select label={t('settings.mcp.modal.oauthGrant')} value={draft.grantType} onChange={(value) => update('grantType', value as McpDraft['grantType'])}>
              <option value="authorization_code">{t('settings.mcp.modal.grantAuthCode')}</option>
              <option value="client_credentials">{t('settings.mcp.modal.grantClientCredentials')}</option>
            </Select>
          </SettingRow>
          <SettingRow name={t('settings.mcp.modal.clientId')}>
            <input className="pivi-settings-control pivi-settings-control--fill" value={draft.clientId} onChange={(event) => update('clientId', event.target.value)} />
          </SettingRow>
          <SettingRow name={t('settings.mcp.modal.clientSecret')}>
            <input className="pivi-settings-control pivi-settings-control--fill" type="password" value={draft.clientSecret} onChange={(event) => update('clientSecret', event.target.value)} />
          </SettingRow>
          <SettingRow name={t('settings.mcp.modal.scope')}>
            <input className="pivi-settings-control pivi-settings-control--fill" value={draft.scope} onChange={(event) => update('scope', event.target.value)} />
          </SettingRow>
        </div>
      ) : null}
      {draft.auth === 'bearer' ? (
        <div className="pivi-provider-endpoint-fields">
          <SettingRow name={t('settings.mcp.modal.bearerToken')}>
            <input className="pivi-settings-control pivi-settings-control--fill" type="password" value={draft.bearerToken} onChange={(event) => update('bearerToken', event.target.value)} />
          </SettingRow>
          <SettingRow name={t('settings.mcp.modal.bearerTokenEnv')}>
            <input className="pivi-settings-control pivi-settings-control--fill" value={draft.bearerTokenEnv} onChange={(event) => update('bearerTokenEnv', event.target.value)} />
          </SettingRow>
        </div>
      ) : null}
      {actions}
    </div>
  );
});
