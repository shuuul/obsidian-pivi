import { resolveActiveChatModel } from '@/ui/chat/stream/UsagePresenter';
import { createFakeChatPorts } from '../../../helpers/createFakeChatPorts';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';

describe('resolveActiveChatModel', () => {
  it('returns undefined when no runtime is bound', () => {
    const ports = createFakeChatPorts();
    expect(resolveActiveChatModel(ports.settings, () => null)).toBeUndefined();
  });

  it('returns settings model when runtime is bound', () => {
    const ports = createFakeChatPorts();
    const runtime = createFakePiChatService();
    expect(resolveActiveChatModel(ports.settings, () => runtime)).toBe(
      'openrouter/openai/gpt-4.1',
    );
  });
});
