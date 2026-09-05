import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { McpOAuthService, McpServerManager } from '@pivi/agent/mcp';
import type { CapabilityApprovalPort, FetchCompatible, HttpClient, SyncSecretStore } from '@pivi/agent/ports';
import type { PiChatService } from '@pivi/agent/runtime/piChatService';

import { PiChatRuntime, type PiChatRuntimeNetwork } from '../runtime/piChatRuntime';
import type { PiRuntimeHost } from '../runtime/piRuntimeHost';
import type { SubagentConcurrencyLimiter } from '../runtime/subagentConcurrencyLimiter';
import type {
  PiBaseToolProvider,
  PiMainOnlyToolProvider,
} from '../tools/buildPiToolRegistryCore';

export interface DeterministicSmokeTurn {
  notePath: string;
  noteContent: string;
  assistantText: string;
  toolCallId: string;
}

export function createDeterministicSmokeChatService(deps: {
  host: PiRuntimeHost;
  httpClient: HttpClient;
  mcpFetch: FetchCompatible;
  mcpSecretStorage?: SyncSecretStore;
  mcpServerManager: McpServerManager | null;
  mcpOAuth: McpOAuthService | null;
  baseToolProvider: PiBaseToolProvider;
  mainOnlyToolProvider?: PiMainOnlyToolProvider | null;
  subagentConcurrencyLimiter?: SubagentConcurrencyLimiter;
  capabilityApproval?: CapabilityApprovalPort | null;
  turn: DeterministicSmokeTurn;
}): PiChatService {
  const faux = createFauxCore({
    api: 'pivi-smoke',
    provider: 'pivi-smoke',
    tokensPerSecond: 0,
  });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('obsidian_write', {
        path: deps.turn.notePath,
        content: deps.turn.noteContent,
        mode: 'create',
      }, { id: deps.turn.toolCallId }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(deps.turn.assistantText),
  ]);

  const network: PiChatRuntimeNetwork = {
    httpClient: deps.httpClient,
    mcpFetch: deps.mcpFetch,
    mcpProcessEnv: process.env,
    mcpSecretStorage: deps.mcpSecretStorage,
  };
  return new PiChatRuntime(
    deps.host,
    network,
    deps.mcpServerManager,
    deps.mcpOAuth,
    deps.baseToolProvider,
    deps.subagentConcurrencyLimiter,
    deps.capabilityApproval ?? null,
    deps.mainOnlyToolProvider ?? null,
    {
      model: faux.getModel(),
      streamFn: faux.streamSimple,
      auth: { auth: { apiKey: 'pivi-smoke' }, source: 'Pivi smoke harness' },
    },
  );
}
