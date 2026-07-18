import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/piRuntimeHost';
import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';

import { attachContextEnvelope } from '../../../../packages/pivi-agent-core/src/engine/pi/piChatRuntimeCompaction';

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
        failedAutoFingerprint: null,
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
});
