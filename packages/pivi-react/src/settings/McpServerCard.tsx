import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpTestResult,
  McpTool,
} from '@pivi/pivi-agent-core/mcp/types';
import { getMcpServerType, supportsMcpOAuth } from '@pivi/pivi-agent-core/mcp/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsFeedbackMessage } from '../ports';
import { SettingsItemActions, SettingsRemoveButton, Toggle } from './controls';
import { McpServerEditor } from './mcp/McpServerEditor';
import { McpToolInventory } from './McpToolInventory';

const refreshError = (cause: unknown, fallback: string): McpTestResult => ({
  success: false,
  tools: [],
  error: cause instanceof Error && cause.message ? cause.message : fallback,
});

export function McpServerCard({
  server,
  expanded,
  authStatus,
  selectorTools,
  busy,
  onConnect,
  onToggleExpanded,
  onToggleEnabled,
  onRemove,
  onLogout,
}: {
  readonly server: ManagedMcpServer;
  readonly expanded: boolean;
  readonly authStatus: McpAuthStatus | null | undefined;
  readonly selectorTools: readonly McpTool[];
  readonly busy: boolean;
  readonly onConnect: (server: ManagedMcpServer) => Promise<McpTestResult>;
  readonly onToggleExpanded: () => void;
  readonly onToggleEnabled: () => Promise<void>;
  readonly onRemove: () => void;
  readonly onLogout: () => Promise<void>;
}) {
  const t = useT();
  const requestGeneration = useRef(0);
  const [refreshResult, setRefreshResult] = useState<McpTestResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const connect = useCallback(async (next: ManagedMcpServer) => {
    const generation = ++requestGeneration.current;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await onConnect(next);
      if (requestGeneration.current === generation) setRefreshResult(result);
    } catch (cause) {
      if (requestGeneration.current === generation) {
        setRefreshResult(refreshError(cause, t('settings.mcp.refreshFailed')));
      }
    } finally {
      if (requestGeneration.current === generation) setRefreshing(false);
    }
  }, [onConnect, t]);

  useEffect(() => () => { requestGeneration.current += 1; }, []);

  const previewConfig = server.config as { command?: string; args?: string[]; url?: string };
  const preview = server.description
    ?? (previewConfig.url ?? [previewConfig.command, ...(previewConfig.args ?? [])].filter(Boolean).join(' '));
  const tools = refreshResult?.success ? refreshResult.tools : selectorTools;
  const connectFeedback: SettingsFeedbackMessage | undefined = refreshResult
    ? refreshResult.success
      ? { kind: 'success', message: t('settings.mcp.test.connected') }
      : { kind: 'error', message: refreshResult.error ?? t('settings.mcp.test.failed') }
    : undefined;

  return (
    <details className={`pivi-mcp-card${!server.enabled ? ' pivi-mcp-card-disabled' : ''}`} open={expanded}>
      <summary
        className="pivi-mcp-card-header"
        onClick={(event) => { event.preventDefault(); onToggleExpanded(); }}
      >
        <span className="pivi-mcp-card-title-row">
          <span className="pivi-mcp-name">{server.name}</span>
          <span className="pivi-mcp-type-badge">{getMcpServerType(server.config)}</span>
          {server.contextSaving ? (
            <span className="pivi-mcp-context-saving-badge" title={t('settings.mcp.contextSavingTitle', { name: server.name })}>/</span>
          ) : null}
          {authStatus === 'authenticated' ? (
            <span className="pivi-mcp-type-badge" title={t('settings.mcp.oauthAuthenticated')}>{t('settings.mcp.oauthBadge')}</span>
          ) : null}
          {authStatus === 'expired' ? (
            <span className="pivi-mcp-type-badge" title={t('settings.mcp.oauthExpiredTitle')}>{t('settings.mcp.oauthExpiredBadge')}</span>
          ) : null}
        </span>
        <span className="pivi-mcp-tool-count">{t('settings.mcp.toolCount', { count: tools.length })}</span>
        <SettingsItemActions>
          <Toggle
            checked={server.enabled}
            disabled={busy}
            label={server.enabled
              ? t('settings.mcp.disableAria', { name: server.name })
              : t('settings.mcp.enableAria', { name: server.name })}
            onChange={() => { void onToggleEnabled(); }}
          />
          <SettingsRemoveButton
            ariaLabel={t('settings.mcp.removeAria', { name: server.name })}
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          />
        </SettingsItemActions>
      </summary>
      <div className="pivi-mcp-card-body">
        {preview ? <p className="pivi-mcp-preview">{preview}</p> : null}
        <McpServerEditor
          server={server}
          inline
          connecting={refreshing}
          feedback={connectFeedback}
          onSave={connect}
        />
        {supportsMcpOAuth(server) && authStatus === 'authenticated'
          ? <div className="pivi-mcp-card-actions">
            <button type="button" disabled={busy} onClick={() => { void onLogout(); }}>{t('settings.mcp.clearOauth')}</button>
          </div>
          : null}
        {tools.length ? <McpToolInventory tools={tools} /> : null}
        {refreshResult?.success && refreshResult.tools.length === 0 ? <p>{t('settings.mcp.test.noTools')}</p> : null}
      </div>
    </details>
  );
}
