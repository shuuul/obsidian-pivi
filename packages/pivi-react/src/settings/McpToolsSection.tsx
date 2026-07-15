import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts, SettingsFeedbackPort } from '../ports';
import { SettingsActionFeedback } from './controls';
import { McpServerEditor } from './mcp/McpServerEditor';
import { useMcpSectionState } from './mcp/useMcpSectionState';
import { McpServerCard } from './McpServerCard';

type McpPorts = SettingsComplexPorts['mcp'];

export function McpToolsSection({ mcp, feedback }: { readonly mcp: McpPorts; readonly feedback: SettingsFeedbackPort }) {
  const t = useT();
  const {
    rootRef,
    state,
    dispatch,
    commit,
    save,
    importClipboard,
    connect,
    logout,
  } = useMcpSectionState(mcp, feedback);
  const {
    servers,
    loading,
    error,
    editor,
    busy,
    auth,
    toolsByServer,
    deleteCandidate,
    addOpen,
    expandedServers,
  } = state;

  const content = loading ? (
    <p>{t('settings.mcp.test.connecting')}</p>
  ) : servers.length === 0 ? (
    <div className="pivi-mcp-empty">{t('settings.mcp.empty')}</div>
  ) : (
    <div className="pivi-mcp-list">
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
          onToggleEnabled={async () => {
            try {
              await commit(servers.map((item) => (item.name === server.name ? { ...item, enabled: !item.enabled } : item)));
            } catch (cause) {
              feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
            }
          }}
          onRemove={() => dispatch({ type: 'set_delete_candidate', server })}
          onLogout={async () => {
            try {
              await logout(server);
            } catch (cause) {
              feedback.notify(cause instanceof Error ? cause.message : t('common.error'));
            }
          }}
        />
      ))}
    </div>
  );

  return (
    <section ref={rootRef} className="pivi-mcp-container">
      {content}
      <div className="pivi-provider-add-controls">
        <div className="pivi-provider-add-container">
          <button
            type="button"
            className="pivi-provider-add-trigger"
            aria-expanded={addOpen}
            onClick={(event) => { event.stopPropagation(); dispatch({ type: 'toggle_add_open' }); }}
          >
            {t('settings.mcp.add')}
          </button>
          <div className={`pivi-provider-add-dropdown${addOpen ? ' is-visible' : ''}`}>
            <div className="pivi-provider-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'stdio' } }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="terminal" /></span>
              <span>{t('settings.mcp.typeStdio')}</span>
            </div>
            <div className="pivi-provider-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'http' } }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="globe" /></span>
              <span>{t('settings.mcp.typeHttp')}</span>
            </div>
            <div className="pivi-provider-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); void importClipboard(); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="clipboard-paste" /></span>
              <span>{t('settings.mcp.importClipboard')}</span>
            </div>
          </div>
        </div>
      </div>
      <SettingsActionFeedback feedback={error ? { kind: 'error', message: error } : undefined} />
      {editor ? (
        <McpServerEditor
          initial={editor.initial}
          type={editor.type}
          onCancel={() => dispatch({ type: 'set_editor', editor: null })}
          onSave={(server) => save(server)}
        />
      ) : null}
      {deleteCandidate ? (
        <div role="dialog" aria-modal="true" aria-label={t('settings.mcp.deleteConfirm', { name: deleteCandidate.name })}>
          <p>{t('settings.mcp.deleteConfirm', { name: deleteCandidate.name })}</p>
          <button type="button" onClick={() => dispatch({ type: 'set_delete_candidate', server: null })}>{t('common.cancel')}</button>
          <button
            type="button"
            onClick={() => {
              void commit(servers.filter((item) => item.name !== deleteCandidate.name))
                .then(() => dispatch({ type: 'set_delete_candidate', server: null }))
                .catch((cause) => feedback.notify(cause instanceof Error ? cause.message : t('common.error')));
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
