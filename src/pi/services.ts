import type { TaskResultInterpreter, TaskTerminalStatus } from "../core/agent/types";
import type PiviPlugin from "../main";
import { QueryBackedInlineEditService } from "./auxiliary/QueryBackedInlineEditService";
import { QueryBackedTitleGenerationService } from "./auxiliary/QueryBackedTitleGenerationService";
import { PiAuxQueryRunner } from "./runtime/PiAuxQueryRunner";

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

export class PiTaskResultInterpreter implements TaskResultInterpreter {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  }

  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  }

  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: TaskTerminalStatus,
  ): TaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  }
}
