import {
  getToolStepPhraseModel,
  resolveToolPresentation,
  type ToolPresentationTitle,
} from '@pivi/pivi-agent-core/tools/toolPresentation';

import { t } from '@/app/i18n';

function translateTitle(title: ToolPresentationTitle): string {
  if (!title.key) return title.fallback;
  return title.params ? t(title.key, title.params) : t(title.key);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
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

export function getToolStepPhrase(
  name: string,
  input: Record<string, unknown>,
  result?: string,
): string {
  const model = getToolStepPhraseModel(name, input, result);
  const base = translateTitle(model.base);
  return model.summary ? truncate(`${base}: ${model.summary}`, 72) : base;
}
