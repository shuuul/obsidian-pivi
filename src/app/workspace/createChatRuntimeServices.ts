import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createPiAuxQueryRunner } from "@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import type { PiRuntimeHost } from "@pivi/pivi-agent-core/engine/pi/piRuntimeHost";
import type { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";
import type { McpOAuthService, McpServerManager } from "@pivi/pivi-agent-core/mcp";
import type { CapabilityApprovalPort, FetchCompatible, HttpClient, SyncSecretStore } from "@pivi/pivi-agent-core/ports";
import type { AuxQueryRunner } from "@pivi/pivi-agent-core/runtime/auxQueryRunner";
import type { PiChatService } from "@pivi/pivi-agent-core/runtime/piChatService";

/**
 * App-layer factories that construct concrete Pi engine services.
 * Product UI must receive only PiChatService / AuxQueryRunner contracts.
 */
export interface CreateChatServiceOptions {
  capabilityApproval?: CapabilityApprovalPort | null;
}

export interface ChatRuntimeServiceFactories {
  createChatService(
    host: PiRuntimeHost,
    httpClient: HttpClient,
    options?: CreateChatServiceOptions,
  ): PiChatService;
  createAuxQueryRunner(host: PiRuntimeHost): AuxQueryRunner;
}

export function createChatRuntimeServiceFactories(deps: {
  mcpServerManager: McpServerManager | null;
  mcpOAuth: McpOAuthService | null;
  baseToolProvider: PiBaseToolProvider | null;
  subagentConcurrencyLimiter: SubagentConcurrencyLimiter;
  mcpSecretStorage?: SyncSecretStore;
  mcpFetch: FetchCompatible;
}): ChatRuntimeServiceFactories {
  return {
    createChatService(host, httpClient, options) {
      return new PiChatRuntime(
        host,
        {
          httpClient,
          mcpFetch: deps.mcpFetch,
          mcpProcessEnv: process.env,
          mcpSecretStorage: deps.mcpSecretStorage,
        },
        deps.mcpServerManager,
        deps.mcpOAuth,
        deps.baseToolProvider,
        deps.subagentConcurrencyLimiter,
        options?.capabilityApproval ?? null,
      );
    },
    createAuxQueryRunner(host) {
      return createPiAuxQueryRunner(host, {
        subagentConcurrencyLimiter: deps.subagentConcurrencyLimiter,
      });
    },
  };
}
