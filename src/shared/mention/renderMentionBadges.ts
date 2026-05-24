import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import { appendMcpIcon } from '../icons';
import type { MentionBadgeParseContext,MentionBadgePart } from './mentionBadgeTypes';
import { messageTextHasMentionBadges, parseMessageMentions } from './parseMessageMentions';

function getFileIconName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
      return 'file-text';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'pdf':
      return 'file-text';
    default:
      return 'file';
  }
}

function openVaultPath(app: App, path: string): void {
  void app.workspace.openLinkText(path, '');
}

function createBadgeButton(
  parent: HTMLElement,
  options: {
    className: string;
    label: string;
    title: string;
    icon?: string;
    useMcpIcon?: boolean;
    onClick?: () => void;
  },
): HTMLElement {
  const badge = parent.createEl('button', {
    cls: options.className,
    attr: { type: 'button', title: options.title },
  });

  const iconEl = badge.createSpan({ cls: 'obsius2-mention-badge-icon' });
  if (options.useMcpIcon) {
    appendMcpIcon(iconEl);
  } else if (options.icon) {
    setIcon(iconEl, options.icon);
  }

  badge.createSpan({ cls: 'obsius2-mention-badge-label', text: options.label });

  if (options.onClick) {
    badge.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onClick?.();
    });
  } else {
    badge.disabled = true;
  }

  return badge;
}

function renderMentionPart(parent: HTMLElement, part: MentionBadgePart, app: App): void {
  switch (part.kind) {
    case 'file':
      createBadgeButton(parent, {
        className: 'obsius2-mention-badge obsius2-mention-badge--context',
        label: part.label,
        title: part.path,
        icon: getFileIconName(part.path),
        onClick: () => openVaultPath(app, part.path),
      });
      return;
    case 'folder':
      createBadgeButton(parent, {
        className: 'obsius2-mention-badge obsius2-mention-badge--context',
        label: part.label,
        title: part.path,
        icon: 'folder',
      });
      return;
    case 'mcp':
      createBadgeButton(parent, {
        className: 'obsius2-mention-badge obsius2-mention-badge--tool',
        label: `@${part.serverName}`,
        title: `MCP server: ${part.serverName}`,
        useMcpIcon: true,
      });
      return;
    case 'skill':
      createBadgeButton(parent, {
        className: 'obsius2-mention-badge obsius2-mention-badge--tool',
        label: `/${part.commandName}`,
        title: `Command: /${part.commandName}`,
        icon: 'sparkles',
      });
      return;
    case 'agent':
      createBadgeButton(parent, {
        className: 'obsius2-mention-badge obsius2-mention-badge--tool',
        label: `@${part.label}`,
        title: `Agent: ${part.agentId}`,
        icon: 'bot',
      });
      return;
    default:
      return;
  }
}

export function renderMentionBadges(
  container: HTMLElement,
  text: string,
  ctx: MentionBadgeParseContext,
): boolean {
  if (!messageTextHasMentionBadges(text)) {
    return false;
  }

  const parts = parseMessageMentions(text, ctx);
  const hasBadges = parts.some((part) => part.kind !== 'plain');
  if (!hasBadges) {
    return false;
  }

  container.empty();
  container.addClass('obsius2-text-with-mentions');

  for (const part of parts) {
    if (part.kind === 'plain') {
      if (part.text) {
        container.appendText(part.text);
      }
      continue;
    }
    renderMentionPart(container, part, ctx.app);
  }

  return true;
}

export function renderMentionBadgeStrip(
  container: HTMLElement,
  parts: MentionBadgePart[],
  app: App,
): void {
  container.empty();

  const badges = parts.filter((part) => part.kind !== 'plain');
  if (badges.length === 0) {
    container.removeClass('obsius2-visible-flex');
    container.addClass('obsius2-hidden');
    return;
  }

  container.addClass('obsius2-visible-flex');
  container.removeClass('obsius2-hidden');

  for (const part of badges) {
    renderMentionPart(container, part, app);
  }
}
