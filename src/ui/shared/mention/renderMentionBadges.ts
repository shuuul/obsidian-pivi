import type { MentionBadgeParseContext,MentionBadgePart } from '@pivi/pivi-agent-core/context/mentions';
import { messageTextHasMentionBadges, parseMessageMentions } from '@pivi/pivi-agent-core/context/mentions';
import type { App } from 'obsidian';

import { mentionPartToContextBadgeToken } from '../context-badge/ContextBadgeParser';
import { createContextBadgeElement } from '../context-badge/ContextBadgeRenderer';
import { revealInlineContext } from './inlineContextNavigation';

function openVaultPath(app: App, path: string): void {
  void app.workspace.openLinkText(path, '');
}

function renderMentionPart(parent: HTMLElement, part: MentionBadgePart, app: App): void {
  if (part.kind === 'plain') return;

  const token = mentionPartToContextBadgeToken(part);

  parent.appendChild(createContextBadgeElement(token, {
    inline: true,
    onClick: token.kind === 'file'
      ? () => openVaultPath(app, token.path)
      : token.kind === 'inline-context'
        ? () => { void revealInlineContext(app, token.context); }
        : undefined,
  }));
}

export function renderMentionBadges(
  container: HTMLElement,
  text: string,
  ctx: MentionBadgeParseContext,
  app: App,
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
    renderMentionPart(container, part, app);
  }

  return true;
}
