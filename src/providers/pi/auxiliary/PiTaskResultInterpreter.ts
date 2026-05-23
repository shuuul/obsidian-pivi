import type { ProviderTaskResultInterpreter, ProviderTaskTerminalStatus } from '../../../core/providers/types';

export class PiTaskResultInterpreter implements ProviderTaskResultInterpreter {
  hasAsyncLaunchMarker(toolUseResult: unknown): boolean {
    return false;
  }
  extractAgentId(toolUseResult: unknown): string | null {
    return null;
  }
  extractStructuredResult(toolUseResult: unknown): string | null {
    return null;
  }
  resolveTerminalStatus(
    toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ): ProviderTaskTerminalStatus {
    return fallbackStatus;
  }
  extractTagValue(payload: string, tagName: string): string | null {
    return null;
  }
}
