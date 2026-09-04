import type {
  ManagedMcpServer,
  McpAuthStatus,
  McpTestResult,
  McpTool,
} from '@pivi/agent/mcp/types';
import { getMcpServerType, supportsMcpOAuth } from '@pivi/agent/mcp/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../i18n';
import type { SettingsFeedbackPort } from '../ports';
import { McpServerEditor, type McpServerEditorHandle } from './mcp/McpServerEditor';
import { McpToolInventory } from './McpToolInventory';
import { DisclosureCard, SettingsRemoveButton, Toggle } from './primitives';

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
  feedback,
  onConnect,
  onToggleExpanded,
  onCollapseExpanded,
  onToggleEnabled,
  onRemove,
  onLogout,
}: {
  readonly server: ManagedMcpServer;
  readonly expanded: boolean;
  readonly authStatus: McpAuthStatus | null | undefined;
  readonly selectorTools: readonly McpTool[];
  readonly busy: boolean;
  readonly feedback: SettingsFeedbackPort;
  readonly onConnect: (server: ManagedMcpServer) => Promise<McpTestResult>;
  readonly onToggleExpanded: () => void;
  readonly onCollapseExpanded: (name: string) => void;
  readonly onToggleEnabled: () => Promise<void>;
  readonly onRemove: () => void;
  readonly onLogout: () => Promise<void>;
}) {
  const t = useT();
  const editorRef = useRef<McpServerEditorHandle>(null);
  const requestGeneration = useRef(0);
  const [refreshResult, setRefreshResult] = useState<McpTestResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const connect = useCallback(async (next: ManagedMcpServer): Promise<boolean> => {
    const generation = ++requestGeneration.current;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await onConnect(next);
      if (requestGeneration.current === generation) {
        setRefreshResult(result);
        if (result.success) {
          feedback.notify(t('settings.mcp.test.connected'));
        } else {
          feedback.notify(result.error ?? t('settings.mcp.test.failed'));
        }
      }
      return result.success;
    } catch (cause) {
      const failed = refreshError(cause, t('settings.mcp.refreshFailed'));
      if (requestGeneration.current === generation) {
        setRefreshResult(failed);
        feedback.notify(failed.error ?? t('settings.mcp.test.failed'));
      }
      return false;
    } finally {
      if (requestGeneration.current === generation) setRefreshing(false);
    }
  }, [feedback, onConnect, t]);

  useEffect(() => () => { requestGeneration.current += 1; }, []);

  const previewConfig = server.config as { command?: string; args?: string[]; url?: string };
  const preview = server.description
    ?? (previewConfig.url ?? [previewConfig.command, ...(previewConfig.args ?? [])].filter(Boolean).join(' '));
  const tools = refreshResult?.success ? refreshResult.tools : selectorTools;

  return (
    <DisclosureCard
      name={server.name}
      className={!server.enabled ? 'is-disabled' : undefined}
      summary={(
        <>
          <span>{t('settings.mcp.toolCount', { count: tools.length })}</span>
          {preview ? ` · ${preview}` : ''}
        </>
      )}
      badges={(
        <>
          <span className="pivi-settings-chip">{getMcpServerType(server.config)}</span>
          {server.contextSaving ? (
            <span className="pivi-settings-chip" title={t('settings.mcp.contextSavingTitle', { name: server.name })}>
              {t('settings.mcp.mentionBadge')}
            </span>
          ) : null}
          {authStatus === 'authenticated' ? (
            <span className="pivi-settings-chip is-configured" title={t('settings.mcp.oauthAuthenticated')}>{t('settings.mcp.oauthBadge')}</span>
          ) : null}
          {authStatus === 'expired' ? (
            <span className="pivi-settings-chip is-error" title={t('settings.mcp.oauthExpiredTitle')}>{t('settings.mcp.oauthExpiredBadge')}</span>
          ) : null}
        </>
      )}
      actions={(
        <>
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
        </>
      )}
      open={expanded}
      onToggle={onToggleExpanded}
      saveDisabled={refreshing}
      onSave={() => {
        void editorRef.current?.save().then((saved) => {
          if (saved) onCollapseExpanded(saved.name);
        });
      }}
    >
      <McpServerEditor
        ref={editorRef}
        server={server}
        inline
        connecting={refreshing}
        onSave={connect}
      />
      {supportsMcpOAuth(server) && authStatus === 'authenticated'
        ? (
          <div className="pivi-settings-action-group">
            <button type="button" disabled={busy} onClick={() => { void onLogout(); }}>
              {t('settings.mcp.clearOauth')}
            </button>
          </div>
        )
        : null}
      {tools.length ? <McpToolInventory tools={tools} /> : null}
      {refreshResult?.success && refreshResult.tools.length === 0 ? <p className="pivi-setting-description">{t('settings.mcp.test.noTools')}</p> : null}
    </DisclosureCard>
  );
}
