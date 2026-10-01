import type { ChatMessage } from '@pivi/agent/runtime';
import type { Skill } from '@pivi/agent/skills/vault/loadVaultSkills';
import type { ToolCallInfo } from '@pivi/agent/tools';
import { TOOL_SKILL } from '@pivi/agent/tools';

function getStringField(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function findSkillForToolCall(toolCall: ToolCallInfo, skills: Skill[]): Skill | undefined {
  const details = toolCall.toolUseResult;
  const name = getStringField(toolCall.input, 'name');
  const filePath = getStringField(details, 'filePath');
  const baseDir = getStringField(details, 'baseDir');

  return skills.find((skill) => (
    (name && skill.name === name) ||
    (filePath && skill.filePath === filePath) ||
    (baseDir && skill.baseDir === baseDir)
  ));
}

export function applySkillDescriptions(
  messages: ChatMessage[],
  skills: Skill[],
): ChatMessage[] {
  if (skills.length === 0) {
    return messages;
  }

  for (const message of messages) {
    if (!message.toolCalls) {
      continue;
    }

    for (const toolCall of message.toolCalls) {
      if (toolCall.name !== TOOL_SKILL || getStringField(toolCall.toolUseResult, 'description')) {
        continue;
      }
      const skill = findSkillForToolCall(toolCall, skills);
      if (skill?.description.trim()) {
        toolCall.toolUseResult = {
          ...toolCall.toolUseResult,
          description: skill.description,
        };
      }
    }
  }

  return messages;
}
