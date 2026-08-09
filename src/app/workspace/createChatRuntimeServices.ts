import { loadContextLayers } from "@pivi/pivi-agent-core/context/loadContextLayers";
import type {
  PiBaseToolProvider,
  PiMainOnlyToolProvider,
} from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import { createPiAuxQueryRunner } from "@pivi/pivi-agent-core/engine/pi/piAuxQueryRunner";
import { PiChatRuntime } from "@pivi/pivi-agent-core/engine/pi/piChatRuntime";
import type { PiRuntimeHost } from "@pivi/pivi-agent-core/engine/pi/piRuntimeHost";
import type { PiSessionTreeFactory } from "@pivi/pivi-agent-core/engine/pi/session/piSessionTree";
import type { SubagentConcurrencyLimiter } from "@pivi/pivi-agent-core/engine/pi/subagentConcurrencyLimiter";
import type { McpOAuthService, McpServerManager } from "@pivi/pivi-agent-core/mcp";
import { PiMcpBridge } from "@pivi/pivi-agent-core/mcp";
import type { CapabilityApprovalPort, FetchCompatible, HttpClient, SyncSecretStore } from "@pivi/pivi-agent-core/ports";
import type { AuxQueryRunner } from "@pivi/pivi-agent-core/runtime/auxQueryRunner";
import type { PiChatService } from "@pivi/pivi-agent-core/runtime/piChatService";
import type { PiviManagementApprovalPort } from '@pivi/pivi-agent-core/tools/piviManagement';

/**
 * App-layer factories that construct concrete Pi engine services.
 * Product UI must receive only PiChatService / AuxQueryRunner contracts.
 */
export interface CreateChatServiceOptions {
  capabilityApproval?: CapabilityApprovalPort | null;
  /** Invoking tab's one-shot approval seam for management tools. */
  piviManagementApproval?: PiviManagementApprovalPort | null;
}

export interface ChatRuntimeServiceFactories {
  createChatService(
    host: PiRuntimeHost,
    httpClient: HttpClient,
    options?: CreateChatServiceOptions,
  ): PiChatService;
  createAuxQueryRunner(host: PiRuntimeHost): AuxQueryRunner;
}

/** Builds a main-only tool provider bound to one chat's management approval port. */
export type MainOnlyToolProviderFactory = (
  approval: PiviManagementApprovalPort | null,
) => PiMainOnlyToolProvider | null;

export function createChatRuntimeServiceFactories(deps: {
  mcpServerManager: McpServerManager | null;
  mcpOAuth: McpOAuthService | null;
  baseToolProvider: PiBaseToolProvider | null;
  /**
   * Per-chat main-only tools from the invoking tab's approval port.
   * Prefer this over a static provider so management mutations fail closed
   * when approval is unavailable while queries remain usable.
   */
  mainOnlyToolProviderFactory?: MainOnlyToolProviderFactory | null;
  /** Static fallback when no per-chat factory is supplied. */
  mainOnlyToolProvider?: PiMainOnlyToolProvider | null;
  subagentConcurrencyLimiter: SubagentConcurrencyLimiter;
  mcpSecretStorage?: SyncSecretStore;
  mcpFetch: FetchCompatible;
  sessionTreeFactory: PiSessionTreeFactory | null;
}): ChatRuntimeServiceFactories {
  return {
    createChatService(host, httpClient, options) {
      const mainOnly = deps.mainOnlyToolProviderFactory
        ? deps.mainOnlyToolProviderFactory(options?.piviManagementApproval ?? null)
        : (deps.mainOnlyToolProvider ?? null);
      return new PiChatRuntime(
        host,
        {
          httpClient,
          mcpFetch: deps.mcpFetch,
          mcpProcessEnv: process.env,
          mcpSecretStorage: deps.mcpSecretStorage,
        },
        deps.sessionTreeFactory,
        deps.mcpServerManager,
        deps.mcpOAuth,
        deps.baseToolProvider,
        deps.subagentConcurrencyLimiter,
        options?.capabilityApproval ?? null,
        mainOnly,
        (manager, oauth, network, vaultPath) => new PiMcpBridge(
          manager,
          oauth,
          network.mcpFetch,
          network.mcpProcessEnv,
          network.mcpSecretStorage,
          vaultPath,
        ),
        loadContextLayers,
      );
    },
    createAuxQueryRunner(host) {
      return createPiAuxQueryRunner(host, {
        subagentConcurrencyLimiter: deps.subagentConcurrencyLimiter,
      });
    },
  };
}
