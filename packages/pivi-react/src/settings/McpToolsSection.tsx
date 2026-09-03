import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts, SettingsFeedbackPort } from '../ports';
import { McpServerEditor } from './mcp/McpServerEditor';
import { useMcpSectionState } from './mcp/useMcpSectionState';
import { McpServerCard } from './McpServerCard';
import { SettingRow, SettingsCollection, SettingsFeedback, SettingsPage, SettingsSection } from './primitives';

type McpPorts = SettingsComplexPorts['mcp'];

export function McpToolsSection({ mcp, feedback }: { readonly mcp: McpPorts; readonly feedback: SettingsFeedbackPort }) {
  const t = useT();
  const {
    rootRef,
    state,
    dispatch,
    commit,
    save,
    importJson,
    connect,
    logout,
    removeServer,
  } = useMcpSectionState(mcp, feedback);
  const {
    servers,
    loading,
    error,
    editor,
    busy,
    auth,
    toolsByServer,
    importDraft,
    addOpen,
    expandedServers,
  } = state;

  const addTrigger = (
    <div className="pivi-provider-add-controls">
      <div className="pivi-provider-add-container">
        <button
          type="button"
          className="pivi-provider-add-trigger pivi-settings-text-btn"
          aria-expanded={addOpen}
          onClick={(event) => { event.stopPropagation(); dispatch({ type: 'toggle_add_open' }); }}
        >
          {t('settings.mcp.add')}
        </button>
        <div className={`pivi-provider-add-dropdown${addOpen ? ' is-visible' : ''}`}>
          <button
            type="button"
            className="pivi-provider-add-option"
            onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'stdio' } }); }}
          >
            <span className="pivi-mcp-add-option-icon"><PlatformIcon name="terminal" /></span>
            <span>{t('settings.mcp.typeStdio')}</span>
          </button>
          <button
            type="button"
            className="pivi-provider-add-option"
            onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'http' } }); }}
          >
            <span className="pivi-mcp-add-option-icon"><PlatformIcon name="globe" /></span>
            <span>{t('settings.mcp.typeHttp')}</span>
          </button>
          <button
            type="button"
            className="pivi-provider-add-option"
            onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_import_draft', draft: '' }); }}
          >
            <span className="pivi-mcp-add-option-icon"><PlatformIcon name="clipboard-paste" /></span>
            <span>{t('settings.mcp.importJson')}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <SettingsPage>
      <SettingsSection>
        <div ref={rootRef}>
          {loading ? (
            <p className="pivi-setting-description">{t('settings.mcp.test.connecting')}</p>
          ) : (
            <SettingsCollection emptyState={t('settings.mcp.empty')}>
              {servers.map((server) => (
                <McpServerCard
                  key={server.name}
                  server={server}
                  expanded={expandedServers.has(server.name)}
                  authStatus={auth[server.name]}
                  selectorTools={toolsByServer[server.name] ?? []}
                  busy={busy !== null}
                  onConnect={(next) => connect(next, server)}
                  onToggleExpanded={() => dispatch({ type: 'toggle_expanded', name: server.name })}
                  onCollapseExpanded={(name) => dispatch({ type: 'collapse_expanded', name })}
                  onToggleEnabled={async () => {
                    try {
                      await commit(servers.map((item) => (item.name === server.name ? { ...item, enabled: !item.enabled } : item)));
                    } catch (cause) {
                      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
                    }
                  }}
                  onRemove={() => { void removeServer(server.name); }}
                  onLogout={async () => {
                    try {
                      await logout(server);
                    } catch (cause) {
                      feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
                    }
                  }}
                />
              ))}
            </SettingsCollection>
          )}
        </div>
        <SettingsFeedback feedback={error ? { kind: 'error', message: error } : undefined} />
        {editor ? (
          <McpServerEditor
            inline
            initial={editor.initial}
            type={editor.type}
            onCancel={() => dispatch({ type: 'set_editor', editor: null })}
            onSave={(server) => save(server)}
          />
        ) : null}
        {importDraft !== null ? (
          <SettingRow
            stacked
            name={t('settings.mcp.importJsonTitle')}
            description={t('settings.mcp.importJsonDescription')}
          >
            <textarea
              autoFocus
              className="pivi-settings-control pivi-settings-control--fill"
              rows={10}
              aria-label={t('settings.mcp.importJsonField')}
              value={importDraft}
              placeholder={t('settings.mcp.importJsonPlaceholder')}
              onChange={(event) => dispatch({ type: 'set_import_draft', draft: event.target.value })}
            />
            <div className="pivi-settings-action-group">
              <button type="button" onClick={() => dispatch({ type: 'set_import_draft', draft: null })}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={busy === 'import' || !importDraft.trim()}
                onClick={() => { void importJson(importDraft); }}
              >
                {t('settings.mcp.importAction')}
              </button>
            </div>
          </SettingRow>
        ) : null}
        {addTrigger}
      </SettingsSection>
    </SettingsPage>
  );
}
