import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { SessionEntry } from '@earendil-works/pi-coding-agent/dist/core/session-manager.js';

import {
  collectMessageUiMap,
  entriesToChatMessages,
} from '../../../src/pi/session/MessageMapper';
import { OBSIUS_MESSAGE_UI } from '../../../src/pi/session/obsiusCustomTypes';

describe('MessageMapper', () => {
  it('maps user and assistant message entries with UI overlay', () => {
    const branch: SessionEntry[] = [
      {
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'hello', timestamp: 1 } as unknown as AgentMessage,
      },
      {
        type: 'custom',
        id: 'c1',
        parentId: 'u1',
        timestamp: '2026-01-01T00:00:01.000Z',
        customType: OBSIUS_MESSAGE_UI,
        data: { targetEntryId: 'u1', displayContent: '/hi' },
      },
      {
        type: 'message',
        id: 'a1',
        parentId: 'c1',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'world', timestamp: 2 } as unknown as AgentMessage,
      },
    ];

    const uiMap = collectMessageUiMap(branch);
    const messages = entriesToChatMessages(branch, uiMap);

    expect(messages).toHaveLength(2);
    expect(messages[0].displayContent).toBe('/hi');
    expect(messages[1].content).toBe('world');
  });
});
