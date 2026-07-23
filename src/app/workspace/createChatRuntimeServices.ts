import { nodeFetch } from "@pivi/obsidian-host/nodeFetch";
import type { PiBaseToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createPiAuxQueryRunner } from "@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import type { PiRuntimeHost } from "@pivi/pivi-agent-core/engine/pi/piRuntimeHost";
import type { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";
import type { McpOAuthService, McpServerManager } from "@pivi/pivi-agent-core/mcp";
import type { HttpClient, SyncSecretStore } from "@pivi/pivi-agent-core/ports";
import type { AuxQueryRunner } from "@pivi/pivi-agent-core/runtime/auxQueryRunner";
import type { PiChatService } from "@pivi/pivi-agent-core/runtime/piChatService";

/**
 * App-layer factories that construct concrete Pi engine services.
 * Product UI must receive only PiChatService / AuxQueryRunner contracts.
 */
export interface ChatRuntimeServiceFactories {
  createChatService(host: PiRuntimeHost, httpClient: HttpClient): PiChatService;
  createAuxQueryRunner(host: PiRuntimeHost): AuxQueryRunner;
}

export function createChatRuntimeServiceFactories(deps: {
  mcpServerManager: McpServerManager | null;
  mcpOAuth: McpOAuthService | null;
  baseToolProvider: PiBaseToolProvider | null;
  subagentConcurrencyLimiter: SubagentConcurrencyLimiter;
  mcpSecretStorage?: SyncSecretStore;
}): ChatRuntimeServiceFactories {
  return {
    createChatService(host, httpClient) {
      return new PiChatRuntime(
        host,
        {
          httpClient,
          mcpFetch: nodeFetch,
          mcpProcessEnv: process.env,
          mcpSecretStorage: deps.mcpSecretStorage,
        },
        deps.mcpServerManager,
        deps.mcpOAuth,
        deps.baseToolProvider,
        deps.subagentConcurrencyLimiter,
      );
    },
    createAuxQueryRunner(host) {
      return createPiAuxQueryRunner(host, {
        subagentConcurrencyLimiter: deps.subagentConcurrencyLimiter,
      });
    },
  };
}
