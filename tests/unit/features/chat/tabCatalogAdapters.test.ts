import type { ChatCatalogPort } from '@pivi/agent/runtime/chatPorts';

import {
  createDropdownMcpToolProvider,
} from '@/ui/chat/tabs/tabCatalogAdapters';

describe('tabCatalogAdapters MCP tool provider', () => {
  it('prefers the inventory catalog seam over runtime listMcpTools', async () => {
    const listMcpTools = jest.fn(async () => [{ name: 'runtime' }]);
    const listMcpInventoryTools = jest.fn(async () => [{ name: 'inventory' }]);
    const catalog = {
      listMcpTools,
      listMcpInventoryTools,
    } as Pick<ChatCatalogPort, 'listMcpTools' | 'listMcpInventoryTools'>;

    const provider = createDropdownMcpToolProvider(catalog as ChatCatalogPort);
    await expect(provider.listTools('remote')).resolves.toEqual([{ name: 'inventory' }]);
    expect(listMcpInventoryTools).toHaveBeenCalledWith('remote');
    expect(listMcpTools).not.toHaveBeenCalled();
  });

  it('falls back to listMcpTools when inventory is not wired', async () => {
    const listMcpTools = jest.fn(async () => [{ name: 'runtime' }]);
    const catalog = {
      listMcpTools,
    } as Pick<ChatCatalogPort, 'listMcpTools'>;

    const provider = createDropdownMcpToolProvider(catalog as ChatCatalogPort);
    await expect(provider.listTools('remote')).resolves.toEqual([{ name: 'runtime' }]);
    expect(listMcpTools).toHaveBeenCalledWith('remote');
  });
});
