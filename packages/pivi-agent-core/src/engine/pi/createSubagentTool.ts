import type { AgentTool } from '@earendil-works/pi-agent-core';
import { TOOL_SPAWN_AGENT } from '@pivi/pivi-agent-core/tools';
import { textResult } from '@pivi/pivi-agent-core/tools/toolResult';

export interface PiSubagentQueryRunner {
  query(options: { systemPrompt: string }, prompt: string): Promise<string>;
  spawn?(options: { systemPrompt: string; toolCallId: string; purpose: string }, prompt: string): Promise<{ agentId: string }>;
  waitForResult?(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }>;
}

export function createSubagentTool(
  runner: PiSubagentQueryRunner,
  options: { allowBackground?: boolean } = {},
): AgentTool {

  return {
    name: TOOL_SPAWN_AGENT,
    label: 'Spawn agent',
    description:
      'Spawn a focused sub-agent for real delegated work. Provide a clear prompt and short stable label. If you delegate context or files, keep the same context batch on the same sub-agent and do not pre-read delegated context in the main session. Use run_in_background=true for asynchronous work. Do not use this tool to check, poll, wait for, or summarize existing sub-agent status; background sub-agents stream their progress/results back automatically.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short stable label displayed while the sub-agent runs; use one label per stable context batch to enable safe reuse' },
        description: { type: 'string', description: 'Short stable label for the subtask/context batch' },
        message: { type: 'string', description: 'Instructions for the sub-agent, including the exact delegated context/files it owns. Do not mix unrelated context batches.' },
        prompt: { type: 'string', description: 'Instructions for the sub-agent (legacy alias for message)' },
        run_in_background: {
          type: 'boolean',
          description: 'If true, starts the sub-agent asynchronously and returns an agent_id immediately. Omit only for a blocking delegated task; never omit it to poll an existing background sub-agent.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as {
        label?: string;
        message?: string;
        prompt: string;
        description?: string;
        run_in_background?: boolean;
      };

      const prompt = (input.message ?? input.prompt)?.trim();
      if (!prompt) {
        throw new Error('message is required');
      }
      if (/^\/compact(?:\s|$)/i.test(prompt)) {
        throw new Error('Subagents cannot run context compaction. Start a fresh subagent with the actual task instead.');
      }

      const description = (input.label ?? input.description)?.trim();
      const systemPrompt = [
        'You are a sub-agent completing one focused task.',
        description ? `Task: ${description}` : '',
        'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent uses stable sub-agent labels to avoid context cross-contamination.',
        'Return a concise final answer only.',
      ]
        .filter(Boolean)
        .join('\n');

      if (input.run_in_background === true) {
        if (options.allowBackground === false) {
          throw new Error('Background sub-agents are disabled in Pivi settings.');
        }
        if (!runner.spawn) {
          throw new Error('Background sub-agents are not available in this runtime.');
        }
        const launch = await runner.spawn({
          systemPrompt,
          toolCallId: _id,
          purpose: description || systemPrompt,
        }, prompt);
        if (!runner.waitForResult) {
          return textResult(JSON.stringify({ agent_id: launch.agentId, status: 'running' }), {
            agent_id: launch.agentId,
            status: 'running',
          });
        }

        const completed = await runner.waitForResult(launch.agentId);
        if (completed.status === 'error') {
          throw new Error(completed.result || 'Background sub-agent failed.');
        }
        return textResult(completed.result, {
          agent_id: launch.agentId,
          status: completed.status,
          result: completed.result,
        });
      }

      const result = await runner.query({ systemPrompt }, prompt);
      return textResult(result);
    },
  };
}
