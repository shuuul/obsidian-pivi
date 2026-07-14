export interface WorkspaceCommandPromptContext {
  selectedText: string;
  currentNote: string;
  currentNoteName: string;
  date: string;
}

export function requiresSelectedText(prompt: string): boolean {
  return prompt.includes('{{selected_text}}');
}

export function resolveWorkspaceCommandPrompt(
  prompt: string,
  context: WorkspaceCommandPromptContext,
): string {
  return prompt
    .replace(/{{selected_text}}/g, context.selectedText)
    .replace(/{{current_note}}/g, context.currentNote)
    .replace(/{{current_file}}/g, context.currentNote)
    .replace(/{{current_note_name}}/g, context.currentNoteName)
    .replace(/{{current_file_name}}/g, context.currentNoteName)
    .replace(/{{date}}/g, context.date);
}
