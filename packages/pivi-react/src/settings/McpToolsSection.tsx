import { useRef } from 'react';

import { useT } from '../i18n';
import type { SettingsComplexPorts, SettingsFeedbackPort } from '../ports';
import { McpServerEditor, type McpServerEditorHandle } from './mcp/McpServerEditor';
import { useMcpSectionState } from './mcp/useMcpSectionState';
import { McpServerCard } from './McpServerCard';
import { DisclosureCard, SettingsCollection, SettingsPage, SettingsSection } from './primitives';

type McpPorts = SettingsComplexPorts['mcp'];

export function McpToolsSection({ mcp, feedback }: { readonly mcp: McpPorts; readonly feedback: SettingsFeedbackPort }) {
  const t = useT();
  const draftEditorRef = useRef<McpServerEditorHandle>(null);
  const {
    rootRef,
    state,
    dispatch,
    commit,
    save,
    connect,
    logout,
    removeServer,
  } = useMcpSectionState(mcp, feedback);
  const {
    servers,
    loading,
    editor,
    busy,
    auth,
    toolsByServer,
    expandedServers,
  } = state;

  const addTrigger = (
    <div className="pivi-provider-add-controls">
      <button
        type="button"
        className="pivi-provider-add-trigger pivi-settings-text-btn"
        onClick={() => dispatch({ type: 'set_editor', editor: { type: 'http' } })}
      >
        {t('settings.mcp.add')}
      </button>
    </div>
  );

  return (
    <SettingsPage>
      <SettingsSection>
        <div ref={rootRef}>
          {loading ? (
            <p className="pivi-setting-description">{t('settings.mcp.test.connecting')}</p>
          ) : (
            <SettingsCollection
              emptyState={servers.length === 0 && !editor ? t('settings.mcp.empty') : undefined}
              addTrigger={addTrigger}
            >
              {servers.map((server) => (
                <McpServerCard
                  key={server.name}
                  server={server}
                  expanded={expandedServers.has(server.name)}
                  authStatus={auth[server.name]}
                  selectorTools={toolsByServer[server.name] ?? []}
                  busy={busy === `connect:${server.name}` || busy === `logout:${server.name}` || busy === `delete:${server.name}`}
                  feedback={feedback}
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
              {editor ? (
                <DisclosureCard
                  name={t('settings.mcp.modal.titleAdd')}
                  open
                  onToggle={() => undefined}
                  showSaveAction={false}
                  footerActions={(
                    <>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'set_editor', editor: null })}
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void draftEditorRef.current?.save(); }}
                      >
                        {t('common.save')}
                      </button>
                    </>
                  )}
                >
                  <McpServerEditor
                    ref={draftEditorRef}
                    inline
                    initial={editor.initial}
                    type={editor.type}
                    onCancel={() => dispatch({ type: 'set_editor', editor: null })}
                    onSave={(server) => save(server)}
                  />
                </DisclosureCard>
              ) : null}
            </SettingsCollection>
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
