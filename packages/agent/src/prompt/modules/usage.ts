import { estimateTextTokens } from '../estimateTextTokens';

export const PROMPT_USAGE_SECTION_IDS = ['core', 'workflow', 'custom', 'tools', 'mcp'] as const;

export interface PromptUsageSectionEstimate {
  readonly id: typeof PROMPT_USAGE_SECTION_IDS[number];
  readonly estimatedTokens: number;
}

export function estimatePromptUsageSections(sections: {
  readonly core: string;
  readonly workflow: string;
  readonly custom: string;
  readonly tools: string;
  readonly mcp: string;
}): readonly PromptUsageSectionEstimate[] {
  return PROMPT_USAGE_SECTION_IDS.map((id) => ({
    id,
    estimatedTokens: estimateTextTokens(sections[id]),
  }));
}
