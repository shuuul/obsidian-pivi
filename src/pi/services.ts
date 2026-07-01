import type PiviPlugin from "../main";
import type { TaskResultInterpreter, TaskTerminalStatus } from "../pi/agent/types";
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
