import { getToolIcon, MCP_ICON_MARKER } from '@pivi/pivi-agent-core/tools/toolPresentation'
import { setIcon } from 'obsidian';

import { appendMcpIcon } from '../../shared/utils/icons';

export function appendToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  el.empty();
  if (icon === MCP_ICON_MARKER) {
    appendMcpIcon(el);
  } else {
    setIcon(el, icon);
  }
}