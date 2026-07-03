import type { AgentTool } from '@earendil-works/pi-agent-core';
import { TOOL_SUBAGENT } from '@pivi/pivi-agent-core/tools';
import { textResult } from '@pivi/pivi-agent-core/tools/toolResult';

export interface PiSubagentQueryRunner {
  query(options: { systemPrompt: string }, prompt: string): Promise<string>;
}

export function createSubagentTool(runner: PiSubagentQueryRunner): AgentTool {

  return {
    name: TOOL_SUBAGENT,
    label: 'Agent',
    description:
      'Spawn a focused sub-agent for a subtask. Provide a clear prompt and short description. Sync only (run_in_background not supported on Pi runtime).',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short label for the subtask' },
        prompt: { type: 'string', description: 'Instructions for the sub-agent' },
        run_in_background: {
          type: 'boolean',
          description: 'If true, runs async (not supported — omit or false)',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as {
        prompt: string;
        description?: string;
        run_in_background?: boolean;
      };

      if (input.run_in_background === true) {
        throw new Error(
          'Background sub-agents are not supported in Pivi Pi runtime. Omit run_in_background or set false.',
        );
      }

      const prompt = input.prompt?.trim();
      if (!prompt) {
        throw new Error('prompt is required');
      }

      const systemPrompt = [
        'You are a sub-agent completing one focused task.',
        input.description ? `Task: ${input.description}` : '',
        'Return a concise final answer only.',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await runner.query({ systemPrompt }, prompt);
      return textResult(result);
    },
  };
}