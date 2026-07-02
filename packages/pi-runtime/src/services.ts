import type { PiRuntimeHost } from './host/runtimeHost';
import { PiAuxQueryRunner } from './PiAuxQueryRunner';
import { QueryBackedInlineEditService } from './QueryBackedInlineEditService';
import { QueryBackedTitleGenerationService } from './QueryBackedTitleGenerationService';

export class PiInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: PiRuntimeHost) {
    super(new PiAuxQueryRunner(plugin));
  }
}

export class PiTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PiRuntimeHost) {
    super({
      createRunner: () => new PiAuxQueryRunner(plugin),
      resolveModel: () =>
        plugin.settings.titleGenerationModel?.trim() || undefined,
    });
  }
}
