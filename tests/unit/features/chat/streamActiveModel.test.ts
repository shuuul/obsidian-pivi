import { DEFAULT_OBSIUS_SETTINGS } from '../../../../src/app/settings/defaultSettings';
import { resolveActiveChatModel } from '../../../../src/features/chat/controllers/streamActiveModel';
import { ensurePiAgentBootstrapped } from '../../../setupPiAgent';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

describe('resolveActiveChatModel', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });
  it('returns undefined when no runtime is bound', () => {
    const plugin = { settings: DEFAULT_OBSIUS_SETTINGS } as never;
    expect(resolveActiveChatModel(plugin, () => null)).toBeUndefined();
  });

  it('returns settings model when runtime is bound', () => {
    const plugin = {
      settings: {
        ...DEFAULT_OBSIUS_SETTINGS,
        model: 'openrouter/openai/gpt-4.1',
        agentSettings: {
          ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
          visibleModels: ['openrouter/openai/gpt-4.1'],
        },
      },
    } as never;
    const runtime = createFakeChatRuntime();
    expect(resolveActiveChatModel(plugin, () => runtime)).toBe('openrouter/openai/gpt-4.1');
  });
});
