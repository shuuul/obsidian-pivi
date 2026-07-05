import { contentFallback, renderLinesExpanded } from './toolCallExpandedShared';

function getStringDetail(details: Record<string, unknown> | undefined, key: string): string {
  const value = details?.[key];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isSkillInstructionResult(result: string): boolean {
  return (
    result.trimStart().startsWith('<skill ') ||
    result.includes('\n</skill>') ||
    result.trimEnd().endsWith('</skill>')
  );
}

export function renderSkillExpanded(
  container: HTMLElement,
  _input: Record<string, unknown>,
  result: string,
  details?: Record<string, unknown>,
): void {
  const description = getStringDetail(details, 'description');
  if (description) {
    contentFallback(container, description);
    return;
  }

  if (isSkillInstructionResult(result)) {
    container.createDiv({ cls: 'pivi-tool-empty', text: 'No description available.' });
    return;
  }

  renderLinesExpanded(container, result, 12);
}
