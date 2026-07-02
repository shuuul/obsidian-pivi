import type { App } from 'obsidian';

import { createContextBadgeElement, mentionPartToContextBadgeToken } from '../context-badge';
import type { MentionBadgeParseContext,MentionBadgePart } from './mentionBadgeTypes';
import { messageTextHasMentionBadges, parseMessageMentions } from './parseMessageMentions';

function openVaultPath(app: App, path: string): void {
  void app.workspace.openLinkText(path, '');
}

function renderMentionPart(parent: HTMLElement, part: MentionBadgePart, app: App): void {
  if (part.kind === 'plain') return;

  const token = mentionPartToContextBadgeToken(part);

  parent.appendChild(createContextBadgeElement(token, {
    app,
    onClick: token.kind === 'file' ? () => openVaultPath(app, token.path) : undefined,
  }));
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
  container.addClass('pivi-text-with-mentions');

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
    container.removeClass('pivi-visible-flex');
    container.addClass('pivi-hidden');
    return;
  }

  container.addClass('pivi-visible-flex');
  container.removeClass('pivi-hidden');

  for (const part of badges) {
    renderMentionPart(container, part, app);
  }
}
