import { SELECTED_TEXT_TEMPLATE_TOKEN } from '../../context/mentions/mentionTokens';

export interface WorkspaceCommandPromptContext {
  selectedText: string;
  currentNote: string;
  currentNoteName: string;
  date: string;
}

export function requiresSelectedText(prompt: string): boolean {
  return prompt.includes(SELECTED_TEXT_TEMPLATE_TOKEN);
}

export function resolveWorkspaceCommandPrompt(
  prompt: string,
  context: WorkspaceCommandPromptContext,
): string {
  return prompt
    .replaceAll(SELECTED_TEXT_TEMPLATE_TOKEN, context.selectedText)
    .replace(/{{current_note}}/g, context.currentNote)
    .replace(/{{current_file}}/g, context.currentNote)
    .replace(/{{current_note_name}}/g, context.currentNoteName)
    .replace(/{{current_file_name}}/g, context.currentNoteName)
    .replace(/{{date}}/g, context.date);
}
