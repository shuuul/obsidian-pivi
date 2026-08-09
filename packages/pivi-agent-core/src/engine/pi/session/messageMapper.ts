import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import type { ChatMessage, ToolCallInfo } from '../../../foundation';
import type { Skill } from '../../../skills/vault/loadVaultSkills';
import { TOOL_SKILL } from '../../../tools/toolNames';
import {
  collectMessageUiMap,
  entriesToChatMessages as entriesToMobileChatMessages,
  firstUserMessagePreview,
  readSessionMetaFromBranch,
} from './mobileMessageMapper';
import {
  estimateActiveContextTokens,
  toCheckpointPresentation,
} from './piContextCompaction';

export { collectMessageUiMap, firstUserMessagePreview, readSessionMetaFromBranch };

export function entriesToChatMessages(
  branch: SessionEntry[],
  messageUiByEntryId: Parameters<typeof entriesToMobileChatMessages>[1],
): ChatMessage[] {
  return entriesToMobileChatMessages(branch, messageUiByEntryId, (entries, entryIndex) => {
    const entry = entries[entryIndex];
    if (!entry || entry.type !== 'compaction') return {};
    const details = (entry as unknown as { details?: { piviCheckpoint?: unknown } }).details;
    return {
      ...(details?.piviCheckpoint ? {
        checkpoint: toCheckpointPresentation(details.piviCheckpoint as never),
      } : {}),
      tokensAfter: estimateActiveContextTokens(entries.slice(0, entryIndex + 1)),
    };
  });
}

function getStringField(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function findSkillForToolCall(toolCall: ToolCallInfo, skills: Skill[]): Skill | undefined {
  const details = toolCall.toolUseResult;
  const name = getStringField(toolCall.input, 'name');
  const filePath = getStringField(details, 'filePath');
  const baseDir = getStringField(details, 'baseDir');
  return skills.find(skill => (name && skill.name === name)
    || (filePath && skill.filePath === filePath)
    || (baseDir && skill.baseDir === baseDir));
}

export function applySkillDescriptions(messages: ChatMessage[], skills: Skill[]): ChatMessage[] {
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      if (toolCall.name !== TOOL_SKILL || getStringField(toolCall.toolUseResult, 'description')) continue;
      const skill = findSkillForToolCall(toolCall, skills);
      if (skill?.description.trim()) {
        toolCall.toolUseResult = { ...toolCall.toolUseResult, description: skill.description };
      }
    }
  }
  return messages;
}
