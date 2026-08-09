import { textResult } from '../toolResult';
import type { ToolSpec } from '../toolSpec';

interface CreatePiviManagementToolOptions<TInput extends { action: string }> {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  promptUsage: NonNullable<ToolSpec['promptUsage']>;
  metadata: NonNullable<ToolSpec['metadata']>;
  parse: (params: unknown) => TInput;
  execute: (input: TInput, signal?: AbortSignal) => Promise<unknown>;
}

export function createPiviManagementTool<TInput extends { action: string }>(
  options: CreatePiviManagementToolOptions<TInput>,
): ToolSpec {
  return {
    name: options.name,
    label: options.label,
    description: options.description,
    parameters: options.parameters,
    promptUsage: options.promptUsage,
    executionMode: 'sequential',
    metadata: options.metadata,
    async execute(_id, params, signal) {
      const input = options.parse(params);
      const result = await options.execute(input, signal);
      return textResult(JSON.stringify(result, null, 2), { action: input.action });
    },
  };
}
