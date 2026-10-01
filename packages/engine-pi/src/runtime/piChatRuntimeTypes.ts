/** Construction-time dependencies of PiChatRuntime. */

import { type StreamFn } from '@earendil-works/pi-agent-core';
import { type AuthResult } from '@earendil-works/pi-ai';
import type {
  McpProcessEnv,
  McpTransportFetch,
} from '@pivi/agent/mcp/ports';
import type {
  HttpClient,
  SyncSecretStore,
} from '@pivi/agent/ports';

import type { PiResolvedModel } from '../models/piModelRegistry';

export interface PiChatRuntimeNetwork {
  httpClient: HttpClient;
  mcpFetch: McpTransportFetch;
  mcpProcessEnv: McpProcessEnv;
  mcpSecretStorage?: SyncSecretStore;
}

/** Engine-local provider seam used by development harnesses and focused tests. */
export interface PiChatRuntimeProviderOverride {
  model: PiResolvedModel;
  streamFn: StreamFn;
  auth: AuthResult;
}
