import { getToolIcon, MCP_ICON_MARKER } from '@pivi/pivi-agent-core/tools/toolIcons';
import { setIcon } from 'obsidian';

import { appendMcpIcon } from '../../shared/utils/icons';

export function setToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    appendMcpIcon(el);
  } else {
    setIcon(el, icon);
  }
}