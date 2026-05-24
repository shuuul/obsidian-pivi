import type { ChatMessage } from '../../../../src/core/types';
import { isResumeCheckpointStillNeeded } from '../../../../src/features/chat/controllers/inputResumeCheckpoint';

describe('isResumeCheckpointStillNeeded', () => {
  it('returns true when resume assistant message is last', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'hi', timestamp: 0 },
      { id: '2', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'resume-1' },
    ];
    expect(isResumeCheckpointStillNeeded('resume-1', messages)).toBe(true);
  });

  it('returns false when messages follow resume point', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'user', content: 'hi', timestamp: 0 },
      { id: '2', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'resume-1' },
      { id: '3', role: 'user', content: 'more', timestamp: 2 },
    ];
    expect(isResumeCheckpointStillNeeded('resume-1', messages)).toBe(false);
  });
});
