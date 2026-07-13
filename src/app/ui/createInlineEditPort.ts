import type { AuxQueryRunner } from '@pivi/pivi-agent-core/runtime/auxQueryRunner';
import type { InlineEditPort } from '@pivi/pivi-react/ports';

export interface InlineEditCompositionHost {
  createAuxQueryRunner(): AuxQueryRunner;
}

export function createInlineEditPort(host: InlineEditCompositionHost): InlineEditPort {
  return {
    createAuxQueryRunner: () => host.createAuxQueryRunner(),
  };
}
