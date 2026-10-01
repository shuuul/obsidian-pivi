import {
  resolveToolPresentation,
  type ToolPresentationTitle,
} from '@pivi/agent/tools/toolPresentation';

import { t } from '@/app/i18n';

function translateTitle(title: ToolPresentationTitle): string {
  if (!title.key) return title.fallback;
  return title.params ? t(title.key, title.params) : t(title.key);
}

export function getToolName(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  return translateTitle(resolveToolPresentation(name, input, result).title);
}

export function getToolSummary(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  return resolveToolPresentation(name, input, result).summary;
}

export function getToolLabel(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  const presentation = resolveToolPresentation(name, input, result);
  const title = translateTitle(presentation.title);
  return presentation.summary ? `${title}: ${presentation.summary}` : title;
}
