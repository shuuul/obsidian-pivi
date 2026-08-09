import { resolveUserMessageDisplayText } from '@pivi/agent/context';
import type { ChatMessage } from '@pivi/agent/foundation';
import type { SessionStore } from '@pivi/agent/session';

export async function readSessionTranscript(options: {
  sessionFile: string;
  store: SessionStore;
}): Promise<string> {
  const ref = await options.store.open(options.sessionFile);
  let page = await options.store.openRecent(ref, 200);
  let messages = [...page.messages];
  while (page.hasOlder) {
    const beforeEntryId = messages[0]?.id;
    if (!beforeEntryId) break;
    page = await options.store.readOlder(ref, beforeEntryId, 200);
    if (page.messages.length === 0) break;
    const existingIds = new Set(messages.map((message) => message.id));
    const older = page.messages.filter((message) => !existingIds.has(message.id));
    if (older.length === 0) break;
    messages = [...older, ...messages];
  }
  return messages.flatMap(formatTranscriptMessage).join('\n\n');
}

function formatTranscriptMessage(message: ChatMessage): string[] {
  if (message.isRebuiltContext) return [];
  if (message.role === 'user') {
    const text = resolveUserMessageDisplayText(message).trim();
    return text ? [`## User\n\n${text}`] : [];
  }
  const text = (message.contentBlocks ?? [])
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim() || (message.contentBlocks ? '' : message.content.trim());
  return text ? [`## Agent\n\n${text}`] : [];
}
