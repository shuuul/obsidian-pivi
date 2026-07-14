import { PluginLogger } from '@pivi/pivi-agent-core/foundation/pluginLogger';
import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import { Notice } from 'obsidian';

import { t } from '@/app/i18n';

import type { ForkContext } from './tabFork';
import type { TabData } from './types';

const logger = new PluginLogger('TabManager');

/** Narrow deps for TabManager fork flows. */
export type TabManagerForkDeps = {
  sessions: ChatPorts['sessions'];
  getActiveTab: () => TabData | null;
  createTab: (openSessionId?: string | null) => Promise<TabData | null>;
};

/**
 * Forks the active session into a new tab and surfaces success/failure Notices.
 */
export async function handleForkRequest(
  deps: TabManagerForkDeps,
  context: ForkContext,
): Promise<void> {
  const tab = await forkToNewTab(deps, context);
  if (!tab) {
    new Notice(t('chat.fork.failed', { error: t('chat.errors.unableCreateForkTab') }));
    return;
  }
  new Notice(t('chat.fork.notice'));
}

/**
 * Creates a forked session and opens it in a new tab.
 * Deletes the forked session if tab creation fails.
 */
export async function forkToNewTab(
  deps: TabManagerForkDeps,
  context: ForkContext,
): Promise<TabData | null> {
  const openSessionId = await createForkSession(deps, context);
  try {
    const tab = await deps.createTab(openSessionId);
    restoreForkPreviewIfEmpty(tab, context);
    return tab;
  } catch (error) {
    await deps.sessions.deleteSession(openSessionId).catch((err) => {
      logger.warn(`Failed to delete session ${openSessionId} after tab creation failure`, err);
    });
    throw error;
  }
}

async function createForkSession(
  deps: TabManagerForkDeps,
  context: ForkContext,
): Promise<string> {
  const activeTab = deps.getActiveTab();
  const sourceOpenSession = activeTab?.openSessionId
    ? deps.sessions.findOpenSession(activeTab.openSessionId)
    : null;

  const title = context.sourceTitle
    ? buildForkTitle(deps.sessions, context.sourceTitle, context.forkAtUserMessage)
    : undefined;

  if (!sourceOpenSession?.sessionFile) {
    throw new Error('Cannot fork: active tab has no JSONL session');
  }

  const forked = await deps.sessions.forkSession(
    sourceOpenSession,
    context.forkAtEntryId,
  );
  if (!forked) {
    throw new Error('Session fork failed');
  }

  const openSession = await deps.sessions.createSession({
    sessionFile: forked.sessionFile,
    sessionId: forked.sessionId,
  });
  await deps.sessions.updateSession(openSession.id, {
    ...(title && { title }),
    ...(context.currentNote && { currentNote: context.currentNote }),
    messages: context.messages,
  });
  return openSession.id;
}

function restoreForkPreviewIfEmpty(tab: TabData | null, context: ForkContext): void {
  if (!tab || tab.state.messages.length > 0 || context.messages.length === 0) {
    return;
  }
  tab.state.messages = context.messages;
}

function buildForkTitle(
  sessions: ChatPorts['sessions'],
  sourceTitle: string,
  forkAtUserMessage?: number,
): string {
  const MAX_TITLE_LENGTH = 50;
  const forkSuffix = forkAtUserMessage ? ` (#${forkAtUserMessage})` : '';
  const forkPrefix = 'Fork: ';
  const maxSourceLength = MAX_TITLE_LENGTH - forkPrefix.length - forkSuffix.length;
  const truncatedSource = sourceTitle.length > maxSourceLength
    ? sourceTitle.slice(0, maxSourceLength - 1) + '…'
    : sourceTitle;
  let title = forkPrefix + truncatedSource + forkSuffix;

  const existingTitles = new Set(sessions.listSessions().map(c => c.title));
  if (existingTitles.has(title)) {
    let n = 2;
    while (existingTitles.has(`${title} ${n}`)) n++;
    title = `${title} ${n}`;
  }

  return title;
}
