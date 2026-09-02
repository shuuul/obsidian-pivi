import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PiRuntimeHost } from '@pivi/engine-pi/piRuntimeHost';
import type { UsageInfo } from '@pivi/agent/runtime';
import { getContextCalibration } from '@pivi/agent/runtime/contextAccounting';
import { estimateTextTokens } from '@pivi/agent/prompt';

import {
  attachContextEnvelope,
  estimateProjectedTurnTokens,
} from '../../../../packages/engine-pi/src/runtime/piChatRuntimeCompaction';

const usage: UsageInfo = {
  contextTokens: 1,
  contextTokensIsAuthoritative: false,
  contextWindow: 200_000,
  contextWindowIsAuthoritative: true,
  inputTokens: 1,
  percentage: 0,
};

describe('attachContextEnvelope', () => {
  it('counts only the pending suffix beyond the persisted session context', () => {
    const persisted = [
      { role: 'user', content: 'question', timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }], timestamp: 2 },
    ] as AgentMessage[];
    const pending = [
      ...persisted,
      { role: 'assistant', content: [{ type: 'text', text: 'pending answer' }], timestamp: 3 },
    ] as AgentMessage[];
    const entries = persisted.map((message, index) => ({
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp: new Date(index).toISOString(),
      type: 'message',
      message,
    }));
    const sessionTree = {
      getLinearLlmContextEntries: () => entries,
      loadAgentMessages: () => persisted,
    };
    const deps = {
      plugin: {} as PiRuntimeHost,
      sessionTree,
      agent: null,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => null,
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    } as never;

    const fromFullAgentState = attachContextEnvelope(deps, usage, undefined, pending);
    const fromPendingSuffix = attachContextEnvelope(deps, usage, undefined, pending.slice(-1));

    expect(fromFullAgentState.contextEnvelope).toEqual(fromPendingSuffix.contextEnvelope);
  });

  it('uses the full authoritative custom output cap before the provider rejects the request', () => {
    const deps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: null,
      agent: null,
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => ({
        contextWindow: 262_144,
        contextWindowIsAuthoritative: true,
        maxTokens: 131_072,
        outputTokenLimitIsAuthoritative: true,
      }),
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    } as never;

    const result = attachContextEnvelope(deps, {
      contextTokens: 129_692,
      contextTokensIsAuthoritative: true,
      contextWindow: 262_144,
      contextWindowIsAuthoritative: true,
      inputTokens: 129_692,
      outputTokenLimit: 131_072,
      percentage: 49,
    });

    expect(result.contextEnvelope).toMatchObject({
      compactionTriggerTokens: 111_072,
      pressureInputTokens: 129_692,
      reservedOutput: { tokens: 131_072 },
    });
  });

  it('projects issue #98 from the provider anchor instead of the full local estimate', () => {
    const anchor = {
      role: 'assistant',
      content: [{ type: 'text', text: 'anchored answer' }],
      provider: 'openai',
      model: 'model-a',
      stopReason: 'stop',
      usage: { input: 119_000, output: 1_000, cacheRead: 0, cacheWrite: 0, totalTokens: 120_000 },
      timestamp: 2,
    } as AgentMessage;
    const trailing = Array.from({ length: 3 }, (_, index) => ({
      role: 'toolResult',
      toolCallId: `tool-${index}`,
      toolName: 'obsidian_read',
      content: [{ type: 'text', text: 'x'.repeat(13_300) }],
      isError: false,
      timestamp: 3 + index,
    })) as AgentMessage[];
    const messages = [
      { role: 'user', content: 'question', timestamp: 1 } as AgentMessage,
      anchor,
      ...trailing,
    ];
    const entries = messages.map((message, index) => ({
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp: new Date(index).toISOString(),
      type: 'message',
      message,
    }));
    const deps = {
      plugin: {} as PiRuntimeHost,
      sessionTree: {
        getLinearLlmContextEntries: () => entries,
        loadAgentMessages: () => messages,
      },
      agent: { state: { systemPrompt: 's'.repeat(640_000), tools: [], messages } },
      compactionState: {
        autoCompactionInFlight: false,
        failedAutoAttempts: new Map(),
        foregroundController: null,
        generation: 0,
        prefire: null,
      },
      resolveModel: () => ({
        provider: 'openai',
        id: 'model-a',
        contextWindow: 200_000,
        contextWindowIsAuthoritative: true,
        maxTokens: 16_000,
      }),
      onLeafIdChanged: jest.fn(),
      onAssistantMessageId: jest.fn(),
    } as never;
    const turn = {
      prompt: 'p'.repeat(13_300),
      persistedContent: 'p'.repeat(13_300),
    };

    const projected = estimateProjectedTurnTokens(deps, turn as never);

    expect(projected).toBeGreaterThanOrEqual(126_000);
    expect(projected).toBeLessThan(131_000);
    expect(projected).toBeLessThan(164_000);

    const selectedTurn = {
      prompt: `${turn.prompt}${' selected'.repeat(1_000)}`,
      persistedContent: turn.persistedContent,
    };
    const withSelectedContext = attachContextEnvelope(deps, usage, selectedTurn as never);
    const rawSelectedContext = estimateTextTokens(selectedTurn.prompt)
      - estimateTextTokens(selectedTurn.persistedContent);
    expect(withSelectedContext.contextEnvelope?.selectedContext.tokens).toBe(
      Math.round(rawSelectedContext * getContextCalibration('openai/model-a')),
    );
  });
});
