import { DEFAULT_PIVI_SETTINGS } from '@pivi/pivi-agent-core/foundation/settingsDefaults';
import { resolveActiveChatModel } from '@/ui/chat/stream/UsagePresenter';
import { createFakePiChatService } from '../../../helpers/fakePiChatService';

describe('resolveActiveChatModel', () => {
  it('returns undefined when no runtime is bound', () => {
    const plugin = { settings: DEFAULT_PIVI_SETTINGS } as never;
    expect(resolveActiveChatModel(plugin, () => null)).toBeUndefined();
  });

  it('returns settings model when runtime is bound', () => {
    const plugin = {
      settings: {
        ...DEFAULT_PIVI_SETTINGS,
        model: 'openrouter/openai/gpt-4.1',
        agentSettings: {
          ...DEFAULT_PIVI_SETTINGS.agentSettings,
          visibleModels: ['openrouter/openai/gpt-4.1'],
        },
      },
    } as never;
    const runtime = createFakePiChatService();
    expect(resolveActiveChatModel(plugin, () => runtime)).toBe('openrouter/openai/gpt-4.1');
  });
});
