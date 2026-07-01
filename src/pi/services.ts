import type PiviPlugin from "../main";
import { PiAuxQueryRunner } from "./runtime/PiAuxQueryRunner";
import { QueryBackedInlineEditService } from "./runtime/QueryBackedInlineEditService";
import { QueryBackedTitleGenerationService } from "./runtime/QueryBackedTitleGenerationService";

export class PiInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: PiviPlugin) {
    super(new PiAuxQueryRunner(plugin));
  }
}

export class PiTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: PiviPlugin) {
    super({
      createRunner: () => new PiAuxQueryRunner(plugin),
      resolveModel: () =>
        plugin.settings.titleGenerationModel?.trim() || undefined,
    });
  }
}
