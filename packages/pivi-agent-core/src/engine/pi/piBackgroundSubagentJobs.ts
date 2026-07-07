import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { StreamChunk, ToolCallInfo } from '@pivi/pivi-agent-core/foundation';
import type { AuxQueryConfig } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';

import { PiAgentEventAdapter } from './piAgentEventAdapter';

interface BackgroundSubagentJob {
  agentId: string;
  toolCallId: string;
  agent: Agent;
  toolCalls: ToolCallInfo[];
  finalResult: string | null;
  error: string | null;
  status: 'running' | 'completed' | 'error';
  completion: Promise<{ status: 'completed' | 'error'; result: string }>;
  resolveCompletion: (result: { status: 'completed' | 'error'; result: string }) => void;
  lastUsedAt: number;
}

export interface PiBackgroundSubagentJobsDependencies {
  createAgent(config: AuxQueryConfig): Promise<Agent>;
  onSubagentChunk?: (chunk: StreamChunk) => void;
  getMaxConcurrentSubagents?: () => number;
}

let nextSubagentId = 1;

function createBackgroundCompletion(): {
  completion: Promise<{ status: 'completed' | 'error'; result: string }>;
  resolveCompletion: (result: { status: 'completed' | 'error'; result: string }) => void;
} {
  let resolveCompletion!: (result: { status: 'completed' | 'error'; result: string }) => void;
  const completion = new Promise<{ status: 'completed' | 'error'; result: string }>((resolve) => {
    resolveCompletion = resolve;
  });
  return { completion, resolveCompletion };
}

export class PiBackgroundSubagentJobs {
  private readonly eventAdapter = new PiAgentEventAdapter();
  private readonly jobs = new Map<string, BackgroundSubagentJob>();

  constructor(private readonly dependencies: PiBackgroundSubagentJobsDependencies) {}

  abortAll(): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        job.status = 'error';
        job.error = 'Cancelled';
        job.finalResult = job.error;
        job.resolveCompletion({ status: 'error', result: job.error });
        job.agent.abort();
      }
      job.agent.reset();
    }
    this.jobs.clear();
  }

  cleanupIdle(): void {
    const maxReusable = this.dependencies.getMaxConcurrentSubagents?.() ?? 3;
    for (const [agentId, job] of this.jobs.entries()) {
      if (job.status === 'error') {
        job.agent.abort();
        this.jobs.delete(agentId);
      }
    }

    const reusable = [...this.jobs.values()]
      .filter((job) => job.status === 'completed')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    for (const stale of reusable.slice(maxReusable)) {
      stale.agent.abort();
      this.jobs.delete(stale.agentId);
    }
  }

  async spawn(
    config: AuxQueryConfig & { toolCallId: string; purpose: string },
    prompt: string,
  ): Promise<{ agentId: string }> {
    if (config.abortController?.signal.aborted) {
      throw new Error('Cancelled');
    }
    if (/^\/compact(?:\s|$)/i.test(prompt.trim())) {
      throw new Error('Subagents cannot run context compaction. Start a fresh subagent with the actual task instead.');
    }
    const maxConcurrent = this.dependencies.getMaxConcurrentSubagents?.() ?? 3;
    const runningCount = [...this.jobs.values()]
      .filter((job) => job.status === 'running').length;
    if (runningCount >= maxConcurrent) {
      throw new Error(`Maximum concurrent subagents reached (${maxConcurrent}).`);
    }

    const job = await this.createJob(config);
    this.startPrompt(job, prompt);
    return { agentId: job.agentId };
  }

  loadToolCalls(agentId: string): ToolCallInfo[] {
    return this.jobs.get(agentId)?.toolCalls.map((toolCall) => ({
      ...toolCall,
      input: { ...toolCall.input },
    })) ?? [];
  }

  loadFinalResult(agentId: string): string | null {
    return this.jobs.get(agentId)?.finalResult ?? null;
  }

  waitForResult(agentId: string): Promise<{ status: 'completed' | 'error'; result: string }> {
    const job = this.jobs.get(agentId);
    if (!job) {
      return Promise.resolve({ status: 'error', result: `Subagent not found: ${agentId}` });
    }
    if (job.status !== 'running') {
      return Promise.resolve({
        status: job.status,
        result: job.finalResult || job.error || (job.status === 'error' ? 'Background task failed.' : 'Background task completed.'),
      });
    }
    return job.completion;
  }

  private async createJob(
    config: AuxQueryConfig & { toolCallId: string },
  ): Promise<BackgroundSubagentJob> {
    const agent = await this.dependencies.createAgent(config);
    const completion = createBackgroundCompletion();
    const job: BackgroundSubagentJob = {
      agentId: `subagent-${Date.now()}-${nextSubagentId++}`,
      toolCallId: config.toolCallId,
      agent,
      toolCalls: [],
      finalResult: null,
      error: null,
      status: 'running',
      ...completion,
      lastUsedAt: Date.now(),
    };
    this.jobs.set(job.agentId, job);
    return job;
  }

  private startPrompt(job: BackgroundSubagentJob, prompt: string): void {
    const unsubscribe = job.agent.subscribe((event) => {
      for (const chunk of this.eventAdapter.adapt(event)) {
        this.recordChunk(job, chunk);
      }
    });

    void job.agent.prompt(prompt)
      .then(() => {
        job.status = 'completed';
        job.lastUsedAt = Date.now();
        job.finalResult = this.extractFinalAssistantText(job.agent.state.messages);
        const result = job.finalResult || 'Background task completed.';
        job.resolveCompletion({ status: 'completed', result });
        this.dependencies.onSubagentChunk?.({
          type: 'async_subagent_result',
          agentId: job.agentId,
          subagentId: job.toolCallId,
          status: 'completed',
          result,
        });
      })
      .catch((error: unknown) => {
        job.status = 'error';
        job.lastUsedAt = Date.now();
        job.error = error instanceof Error ? error.message : String(error);
        job.finalResult = job.error;
        job.resolveCompletion({ status: 'error', result: job.error });
        this.dependencies.onSubagentChunk?.({
          type: 'async_subagent_result',
          agentId: job.agentId,
          subagentId: job.toolCallId,
          status: 'error',
          result: job.error,
        });
      })
      .finally(() => {
        unsubscribe();
      });
  }

  private recordChunk(job: BackgroundSubagentJob, chunk: StreamChunk): void {
    if (chunk.type === 'text') {
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_text', subagentId: job.toolCallId });
      return;
    }

    if (chunk.type === 'tool_use') {
      const toolCall: ToolCallInfo = {
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
        status: 'running',
        isExpanded: false,
      };
      job.toolCalls.push(toolCall);
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_tool_use', subagentId: job.toolCallId });
      return;
    }

    if (chunk.type === 'tool_result') {
      const toolCall = job.toolCalls.find((candidate) => candidate.id === chunk.id);
      if (toolCall) {
        toolCall.status = chunk.isError ? 'error' : 'completed';
        toolCall.result = chunk.content;
        if (chunk.toolUseResult) {
          toolCall.toolUseResult = chunk.toolUseResult;
        }
      }
      this.dependencies.onSubagentChunk?.({ ...chunk, type: 'subagent_tool_result', subagentId: job.toolCallId });
    }
  }

  private extractFinalAssistantText(messages: AgentMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index] as unknown as Record<string, unknown>;
      if (message.role !== 'assistant') {
        continue;
      }
      const content = message.content;
      if (typeof content === 'string') {
        return content;
      }
      if (!Array.isArray(content)) {
        continue;
      }
      const text = content.map((part) => {
        if (!part || typeof part !== 'object') return '';
        const record = part as Record<string, unknown>;
        return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
      }).filter(Boolean).join('\n').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }
}
