import type { AgentTool } from '@earendil-works/pi-agent-core';
import { TOOL_SPAWN_AGENT } from '@pivi/pivi-agent-core/tools';
import { textResult } from '@pivi/pivi-agent-core/tools/toolResult';

export interface PiSubagentQueryRunner {
  query(options: { systemPrompt: string }, prompt: string): Promise<string>;
  spawn?(options: { abortController?: AbortController; systemPrompt: string; toolCallId: string; purpose: string }, prompt: string): Promise<{
    agentId: string;
    maxConcurrentSubagents: number;
    queuePosition: number | null;
    queued: boolean;
    runningAtRequest: number;
    runningAtStart: number;
  }>;
  waitForResult?(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }>;
}

function formatBackgroundResult(
  agentId: string,
  completion: { status: 'completed' | 'error'; result: string },
  concurrency?: {
    maxConcurrentSubagents: number;
    queuePosition: number | null;
    queued: boolean;
    runningAtRequest: number;
    runningAtStart: number;
  },
): string {
  const status = completion.status === 'error' ? 'failed' : 'completed';
  return [
    concurrency?.queued
      ? `Concurrency limit exceeded at request time (${concurrency.runningAtRequest}/${concurrency.maxConcurrentSubagents} running). This sub-agent waited in FIFO queue position ${concurrency.queuePosition ?? 1} before starting.`
      : concurrency
        ? `Launch concurrency: ${concurrency.runningAtStart}/${concurrency.maxConcurrentSubagents}.`
        : '',
    `Background sub-agent ${agentId} ${status}.`,
    completion.result,
  ].filter(Boolean).join('\n\n');
}

export function createSubagentTool(
  runner: PiSubagentQueryRunner,
  options: { allowBackground?: boolean; maxConcurrentSubagents?: number } = {},
): AgentTool {

  const maxConcurrent = options.maxConcurrentSubagents ?? 3;

  return {
    name: TOOL_SPAWN_AGENT,
    label: 'Spawn agent',
    description:
      `Spawn a focused sub-agent for real delegated work. At most ${maxConcurrent} background sub-agents run concurrently across this Pivi plugin, shared across tabs. Sub-agents are an active strategy: if the user asks for, allows, or says you can/may use them, use them for safely parallel work. For a large folder or attached-file list, create ${maxConcurrent} balanced non-overlapping batches (or fewer only when fewer useful batches exist) and emit all spawn_agent calls together in the same assistant response with run_in_background=true. Do not spawn one worker and wait when multiple independent batches are ready. Excess calls wait in FIFO order and report that they exceeded immediate capacity. Pass the task instructions in message and a short stable name in label. If you delegate context or files, do not inspect delegated context in the main session before the worker reports. Set run_in_background=false only for a deliberately blocking delegated task. Do not use this tool to check, poll, wait for, or summarize existing sub-agent status.`,
    executionMode: 'parallel',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short stable label displayed while the sub-agent runs; use one label per context batch for auditability' },
        message: { type: 'string', description: 'Instructions for the sub-agent, including the exact delegated context/files it owns. Do not mix unrelated context batches.' },
        run_in_background: {
          type: 'boolean',
          description: 'Required. Use true for normal delegation and concurrent batches. Use false only for a deliberately blocking delegated task.',
        },
      },
      required: ['label', 'message', 'run_in_background'],
      additionalProperties: false,
    },
    async execute(_id, params, signal) {
      const input = params as {
        label: string;
        message: string;
        run_in_background?: boolean;
      };

      const prompt = input.message?.trim();
      if (!prompt) {
        throw new Error('message is required');
      }
      if (/^\/compact(?:\s|$)/i.test(prompt)) {
        throw new Error('Subagents cannot run context compaction. Start a fresh subagent with the actual task instead.');
      }

      const description = input.label?.trim();
      const systemPrompt = [
        'You are a sub-agent completing one focused task.',
        description ? `Task: ${description}` : '',
        'Only work on the exact context batch/files assigned in your prompt. Do not pull in unrelated context batches; the main agent keeps each spawn_agent call isolated to avoid context cross-contamination.',
        'Reply in the same language as the task prompt/instructions you received.',
        'Return a concise final answer only.',
      ]
        .filter(Boolean)
        .join('\n');

      if (input.run_in_background !== false) {
        if (options.allowBackground === false) {
          throw new Error('Background sub-agents are disabled in Pivi settings.');
        }
        if (!runner.spawn) {
          throw new Error('Background sub-agents are not available in this runtime.');
        }
        if (!runner.waitForResult) {
          throw new Error('Background sub-agents cannot be awaited in this runtime.');
        }
        const abortController = new AbortController();
        const abortHandler = (): void => abortController.abort();
        if (signal?.aborted) {
          throw new Error('Cancelled');
        }
        signal?.addEventListener('abort', abortHandler, { once: true });
        let launch: Awaited<ReturnType<NonNullable<PiSubagentQueryRunner['spawn']>>>;
        try {
          launch = await runner.spawn({
            abortController,
            systemPrompt,
            toolCallId: _id,
            purpose: description || systemPrompt,
          }, prompt);
        } finally {
          signal?.removeEventListener('abort', abortHandler);
        }
        const completion = await runner.waitForResult(launch.agentId);
        const concurrency = {
          maxConcurrentSubagents: launch.maxConcurrentSubagents,
          queuePosition: launch.queuePosition,
          queued: launch.queued,
          runningAtRequest: launch.runningAtRequest,
          runningAtStart: launch.runningAtStart,
        };
        return textResult(formatBackgroundResult(launch.agentId, completion, concurrency), {
          agent_id: launch.agentId,
          concurrency: {
            max_concurrent_subagents: launch.maxConcurrentSubagents,
            queue_position: launch.queuePosition,
            queued: launch.queued,
            running_at_request: launch.runningAtRequest,
            running_at_start: launch.runningAtStart,
          },
          status: completion.status,
          result: completion.result,
        });
      }

      const result = await runner.query({ systemPrompt }, prompt);
      return textResult(result);
    },
  };
}
