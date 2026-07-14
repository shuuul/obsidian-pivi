import { useT } from '../i18n';
import { PlatformIcon } from '../icons';
import type { SettingsComplexPorts } from '../ports';
import { SettingsListHeader } from './controls';
import { McpServerEditor } from './mcp/McpServerEditor';
import { useMcpTabState } from './mcp/useMcpTabState';
import { McpServerCard } from './McpServerCard';

type McpPorts = SettingsComplexPorts['mcp'];

export function McpTab({ mcp }: { readonly mcp: McpPorts }) {
  const t = useT();
  const {
    rootRef,
    state,
    dispatch,
    commit,
    save,
    importClipboard,
    authenticate,
    logout,
  } = useMcpTabState(mcp);
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
          mcp={mcp}
          configEditor={(
            <McpServerEditor
              server={server}
              inline
              onSave={(next) => save(next, server)}
            />
          )}
          onToggleExpanded={() => dispatch({ type: 'toggle_expanded', name: server.name })}
          onToggleEnabled={() => commit(servers.map((item) => (item.name === server.name ? { ...item, enabled: !item.enabled } : item)))}
          onRemove={() => dispatch({ type: 'set_delete_candidate', server })}
          onAuthenticate={() => authenticate(server)}
          onLogout={() => logout(server)}
        />
      ))}
    </div>
  );

  return (
    <section ref={rootRef} className="pivi-mcp-container">
      <SettingsListHeader
        actions={<div className="pivi-mcp-add-container">
          <button
            type="button"
            className="pivi-settings-action-btn"
            aria-label={t('settings.mcp.add')}
            aria-expanded={addOpen}
            onClick={(event) => { event.stopPropagation(); dispatch({ type: 'toggle_add_open' }); }}
          >
            <PlatformIcon name="plus" />
          </button>
          <div className={`pivi-mcp-add-dropdown${addOpen ? ' is-visible' : ''}`}>
            <div className="pivi-mcp-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'stdio' } }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="terminal" /></span>
              <span>{t('settings.mcp.typeStdio')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); dispatch({ type: 'set_editor', editor: { type: 'http' } }); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="globe" /></span>
              <span>{t('settings.mcp.typeHttp')}</span>
            </div>
            <div className="pivi-mcp-add-option" onClick={() => { dispatch({ type: 'set_add_open', open: false }); void importClipboard(); }}>
              <span className="pivi-mcp-add-option-icon"><PlatformIcon name="clipboard-paste" /></span>
              <span>{t('settings.mcp.importClipboard')}</span>
            </div>
          </div>
        </div>}
      />
      {error ? <p role="alert">{error}</p> : null}
      {content}
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
            onClick={() => { void commit(servers.filter((item) => item.name !== deleteCandidate.name)).then(() => dispatch({ type: 'set_delete_candidate', server: null })); }}
          >
            {t('common.delete')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
