import { shouldSendMessageFromEnterKey } from '../../../../src/features/chat/tabs/tabAgentContext';

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return partial as KeyboardEvent;
}

describe('shouldSendMessageFromEnterKey', () => {
  it('sends on Enter when modifier not required', () => {
    expect(shouldSendMessageFromEnterKey(
      keyEvent({ key: 'Enter' }),
      { requireCommandOrControlEnterToSend: false },
    )).toBe(true);
  });

  it('ignores Shift+Enter', () => {
    expect(shouldSendMessageFromEnterKey(
      keyEvent({ key: 'Enter', shiftKey: true }),
      { requireCommandOrControlEnterToSend: false },
    )).toBe(false);
  });
});
