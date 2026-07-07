import type { AgentTool } from '@earendil-works/pi-agent-core';
import { TOOL_SPAWN_AGENT } from '@pivi/pivi-agent-core/tools';
import { textResult } from '@pivi/pivi-agent-core/tools/toolResult';

export interface PiSubagentQueryRunner {
  query(options: { systemPrompt: string }, prompt: string): Promise<string>;
  spawn?(options: { systemPrompt: string; toolCallId: string; purpose: string }, prompt: string): Promise<{ agentId: string }>;
  waitForResult?(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }>;
}

function formatBackgroundResult(
  agentId: string,
  completion: { status: 'completed' | 'error'; result: string },
): string {
  const status = completion.status === 'error' ? 'failed' : 'completed';
  return [
    `Background sub-agent ${agentId} ${status}.`,
    completion.result,
  ].filter(Boolean).join('\n\n');
}

export function createSubagentTool(
  runner: PiSubagentQueryRunner,
  options: { allowBackground?: boolean } = {},
): AgentTool {

  return {
    name: TOOL_SPAWN_AGENT,
    label: 'Spawn agent',
    description:
      'Spawn a focused sub-agent for real delegated work. Provide a clear prompt and short stable label. If you delegate context or files, assign one non-overlapping context batch per sub-agent and do not pre-read delegated context in the main session. Use run_in_background=true for asynchronous work that streams progress and returns a final report for your synthesis. Do not use this tool to check, poll, wait for, or summarize existing sub-agent status.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short stable label displayed while the sub-agent runs; use one label per context batch for auditability' },
        description: { type: 'string', description: 'Short stable label for the subtask/context batch' },
        message: { type: 'string', description: 'Instructions for the sub-agent, including the exact delegated context/files it owns. Do not mix unrelated context batches.' },
        prompt: { type: 'string', description: 'Instructions for the sub-agent (legacy alias for message)' },
        run_in_background: {
          type: 'boolean',
          description: 'If true, runs the sub-agent asynchronously while streaming its progress, then returns its final result to the main agent for synthesis. Omit only for a blocking delegated task; never omit it to poll an existing background sub-agent.',
        },
      },
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
        'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent keeps each spawn_agent call isolated to avoid context cross-contamination.',
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
        if (!runner.waitForResult) {
          throw new Error('Background sub-agents cannot be awaited in this runtime.');
        }
        const launch = await runner.spawn({
          systemPrompt,
          toolCallId: _id,
          purpose: description || systemPrompt,
        }, prompt);
        const completion = await runner.waitForResult(launch.agentId);
        return textResult(formatBackgroundResult(launch.agentId, completion), {
          agent_id: launch.agentId,
          status: completion.status,
          result: completion.result,
        });
      }

      const result = await runner.query({ systemPrompt }, prompt);
      return textResult(result);
    },
  };
}
