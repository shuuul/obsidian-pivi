import { OBSIUS_SETTINGS_PATH, ObsiusSettingsStorage } from '../../../../src/app/settings/ObsiusSettingsStorage';
import type { VaultFileAdapter } from '../../../../src/core/storage/VaultFileAdapter';
import { ensurePiAgentBootstrapped } from '../../../setupPiAgent';

function createMemoryAdapter(initialContent?: string): Pick<VaultFileAdapter, 'exists' | 'read' | 'write'> & {
  writes: string[];
} {
  let content = initialContent;
  const adapter: Pick<VaultFileAdapter, 'exists' | 'read' | 'write'> & { writes: string[] } = {
    writes: [],
    exists: jest.fn(async () => content !== undefined),
    read: jest.fn(async () => content ?? ''),
    write: jest.fn(async (_path: string, nextContent: string) => {
      content = nextContent;
      adapter.writes.push(nextContent);
    }),
  };
  return adapter;
}

describe('ObsiusSettingsStorage', () => {
  beforeAll(() => {
    ensurePiAgentBootstrapped();
  });

  it('removes legacy settings-backed custom system prompt on load', async () => {
    const stored = {
      userName: 'Alice',
      model: 'opencode-go/deepseek-v4-flash',
      systemPrompt: 'Legacy custom instructions',
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new ObsiusSettingsStorage(adapter as unknown as VaultFileAdapter);

    const settings = await storage.load();

    expect(settings).not.toHaveProperty('systemPrompt');
    expect(adapter.write).toHaveBeenCalledWith(
      OBSIUS_SETTINGS_PATH,
      expect.not.stringContaining('Legacy custom instructions'),
    );
    expect(JSON.parse(adapter.writes[0] ?? '{}')).not.toHaveProperty('systemPrompt');
  });

  it('normalizes agent settings through the active runtime registration', async () => {
    const stored = {
      agentSettings: {
        visibleModels: ['unknown-provider/model'],
      },
      model: 'unknown-provider/model',
    };
    const adapter = createMemoryAdapter(JSON.stringify(stored));
    const storage = new ObsiusSettingsStorage(adapter as unknown as VaultFileAdapter);

    const settings = await storage.load();

    expect(settings.model).toBe('opencode-go/deepseek-v4-flash');
    expect(settings.agentSettings.visibleModels).toEqual(['opencode-go/deepseek-v4-flash']);
    expect(adapter.write).toHaveBeenCalledWith(OBSIUS_SETTINGS_PATH, expect.any(String));
  });
});
