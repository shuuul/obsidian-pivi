import { DEFAULT_OBSIUS_SETTINGS } from '../../../../src/app/settings/defaultSettings';
import { resolveActiveChatModel } from '../../../../src/features/chat/controllers/streamActiveModel';
import { bootstrapPiAgent } from '../../../../src/pi/bootstrap';
import { createFakeChatRuntime } from '../../../helpers/fakeChatRuntime';

describe('resolveActiveChatModel', () => {
  beforeAll(() => {
    bootstrapPiAgent();
  });
  it('returns undefined when no runtime is bound', () => {
    const plugin = { settings: DEFAULT_OBSIUS_SETTINGS } as never;
    expect(resolveActiveChatModel(plugin, () => null)).toBeUndefined();
  });

  it('returns settings model when runtime is bound', () => {
    const plugin = {
      settings: {
        ...DEFAULT_OBSIUS_SETTINGS,
        model: 'openai/gpt-4.1',
        agentSettings: {
          ...DEFAULT_OBSIUS_SETTINGS.agentSettings,
          visibleModels: ['openai/gpt-4.1'],
        },
      },
    } as never;
    const runtime = createFakeChatRuntime();
    expect(resolveActiveChatModel(plugin, () => runtime)).toBe('openai/gpt-4.1');
  });
});
