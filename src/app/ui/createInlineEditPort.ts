import type { InlineEditPort } from '@pivi/obsidian-react/ports';
import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';

export interface InlineEditCompositionHost {
  createAuxQueryRunner(): AuxQueryRunner;
}

export function createInlineEditPort(host: InlineEditCompositionHost): InlineEditPort {
  return {
    createAuxQueryRunner: () => host.createAuxQueryRunner(),
  };
}
