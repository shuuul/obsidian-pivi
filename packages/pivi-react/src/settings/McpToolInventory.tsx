import type { McpTool } from '@pivi/pivi-agent-core/mcp/types';

import { useT } from '../i18n';

export function McpToolInventory({ tools }: { readonly tools: readonly McpTool[] }) {
  const t = useT();

  return (
    <section className="pivi-mcp-tool-inventory">
      <p className="pivi-mcp-tool-inventory-title">
        {t('settings.mcp.test.availableTools', { count: tools.length })}
      </p>
      <div className="pivi-mcp-tool-inventory-grid">
        {tools.map((tool) => (
          <div className="pivi-mcp-tool-card" key={tool.name}>
            <span className="pivi-mcp-tool-name">{tool.name}</span>
            {tool.description ? <span className="pivi-mcp-tool-description">{tool.description}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
