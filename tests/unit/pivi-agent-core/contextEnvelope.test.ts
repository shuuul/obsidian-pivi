import {
  calculateContextEnvelope,
  DEFAULT_COMPACTION_RESERVE_TOKENS,
  DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS,
  DEFAULT_RESERVED_OUTPUT_TOKENS,
} from '@pivi/pivi-agent-core/foundation/usage';

describe('context envelope', () => {
  it('uses the conservative default budgets for a 200K context window', () => {
    const envelope = calculateContextEnvelope({
      checkpoints: 6_000,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      recentConversation: 31_000,
      selectedContext: 19_000,
      system: 8_000,
      toolAndAgentResults: 8_000,
    });

    expect(envelope).toMatchObject({
      compactionReserve: { source: 'estimated', tokens: DEFAULT_COMPACTION_RESERVE_TOKENS },
      compactionTriggerTokens: 164_000,
      contextWindow: { source: 'authoritative', tokens: 200_000 },
      reservedOutput: { source: 'estimated', tokens: DEFAULT_RESERVED_OUTPUT_TOKENS },
      safetyMargin: { source: 'estimated', tokens: DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS },
      total: { source: 'estimated', tokens: 72_000 },
      usableInputTokens: 164_000,
    });
  });

  it('marks only a provider-reported total as authoritative', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      providerContextTokens: 81_234,
      recentConversation: 31_000,
      system: 8_000,
    });

    expect(envelope.total).toEqual({ source: 'authoritative', tokens: 81_234 });
    expect(envelope.estimatedInputTokens).toBe(39_000);
    expect(envelope.pressureInputTokens).toBe(81_234);
    expect(envelope.system.source).toBe('estimated');
    expect(envelope.recentConversation.source).toBe('estimated');
  });

  it('keeps a newer local estimate as pressure above an older provider total', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 200_000,
      providerContextTokens: 10_000,
      recentConversation: 31_000,
      system: 8_000,
    });

    expect(envelope.total).toEqual({ source: 'authoritative', tokens: 10_000 });
    expect(envelope.pressureInputTokens).toBe(39_000);
  });

  it('scales default reserves down for small windows', () => {
    const envelope = calculateContextEnvelope({ contextWindow: 32_000 });

    expect(envelope.reservedOutput.tokens).toBe(8_000);
    expect(envelope.compactionReserve.tokens).toBe(3_200);
    expect(envelope.safetyMargin.tokens).toBe(1_600);
    expect(envelope.usableInputTokens).toBe(19_200);
    expect(envelope.compactionTriggerTokens).toBe(19_200);
  });

  it('uses explicit output limits and normalizes invalid category values', () => {
    const envelope = calculateContextEnvelope({
      contextWindow: 64_000,
      outputTokenLimit: 4_096,
      recentConversation: Number.NaN,
      selectedContext: -10,
    });

    expect(envelope.reservedOutput.tokens).toBe(4_096);
    expect(envelope.recentConversation.tokens).toBe(0);
    expect(envelope.selectedContext.tokens).toBe(0);
  });

  it('marks the fallback context window as estimated', () => {
    const envelope = calculateContextEnvelope({ recentConversation: 1_000 });

    expect(envelope.contextWindow).toEqual({ source: 'estimated', tokens: 200_000 });
  });

  it('does not present a heuristic nonzero context window as authoritative', () => {
    const envelope = calculateContextEnvelope({ contextWindow: 200_000 });

    expect(envelope.contextWindow).toEqual({ source: 'estimated', tokens: 200_000 });
  });
});
