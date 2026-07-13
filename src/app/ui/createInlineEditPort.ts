import type { InlineEditPort } from '@pivi/obsidian-ui/ports';

import type { PiviChatHost } from '@/app/hostContracts';

export function createInlineEditPort(host: PiviChatHost): InlineEditPort {
  return {
    createAuxQueryRunner: () => host.createAuxQueryRunner(),
  };
}
