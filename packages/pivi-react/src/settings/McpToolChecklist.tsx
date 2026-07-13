import type { McpTestResult } from '@pivi/pivi-agent-core/mcp/types';
import { useState } from 'react';

import { useT } from '../i18n';

type McpTool = McpTestResult['tools'][number];

export interface McpToolChecklistProps {
  readonly tools: readonly McpTool[];
  readonly disabledTools: readonly string[];
  readonly onChange: (disabledTools: string[]) => Promise<void>;
}

export function McpToolChecklist({ tools, disabledTools, onChange }: McpToolChecklistProps) {
  const t = useT();
  const [disabled, setDisabled] = useState(() => new Set(disabledTools));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = async (next: Set<string>) => {
    const previous = disabled;
    setDisabled(next);
    setBusy(true);
    setError('');
    try {
      await onChange([...next]);
    } catch (cause) {
      setDisabled(previous);
      setError(cause instanceof Error && cause.message
        ? cause.message
        : t('settings.mcp.test.toggleFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pivi-mcp-tool-checklist">
      <div className="pivi-mcp-tool-checklist-header">
        <p>{t('settings.mcp.test.availableTools', { count: tools.length })}</p>
        <div className="pivi-mcp-tool-checklist-actions">
          <button type="button" disabled={busy || tools.every((tool) => !disabled.has(tool.name))} onClick={() => { void change(new Set()); }}>
            {t('settings.mcp.test.enableAll')}
          </button>
          <button type="button" disabled={busy || tools.every((tool) => disabled.has(tool.name))} onClick={() => { void change(new Set(tools.map((tool) => tool.name))); }}>
            {t('settings.mcp.test.disableAll')}
          </button>
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="pivi-mcp-tool-checklist-grid">
        {tools.map((tool, index) => {
          const inputId = `pivi-mcp-tool-${index}-${tool.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          return (
            <div className="pivi-mcp-tool-checkbox-wrapper" key={tool.name}>
              <input
                id={inputId}
                className="pivi-mcp-tool-checkbox"
                type="checkbox"
                checked={!disabled.has(tool.name)}
                disabled={busy}
                onChange={(event) => {
                  const next = new Set(disabled);
                  if (event.target.checked) next.delete(tool.name);
                  else next.add(tool.name);
                  void change(next);
                }}
              />
              <label className="pivi-mcp-tool-checkbox-label" htmlFor={inputId}>
                <span className="pivi-mcp-tool-checkbox-title">{tool.name}</span>
                {tool.description ? <span className="pivi-mcp-tool-checkbox-desc">{tool.description}</span> : null}
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
