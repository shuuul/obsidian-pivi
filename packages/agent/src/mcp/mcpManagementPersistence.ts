import type { SyncSecretStore } from '../ports';
import type {
  AgentMcpBearerInput,
  AgentMcpOAuthInput,
  AgentMcpServerInput,
} from '../tools/piviManagement';
import { PiviManagementError } from '../tools/piviManagement';
import type { McpManagementMutation, McpManagementPlan } from './mcpManagementCoordinator';
import { hydrateMcpDirectSecrets } from './mcpManagementProjection';
import {
  listMcpServerSecretIds,
  type McpStorage,
  McpStorageStateChangedError,
} from './mcpStorage';
import { normalizeMcpStoredValueMap } from './mcpValueSources';
import { listMcpAuthEntrySecretIds } from './oauth/mcpSecretAuthStore';
import type { ManagedMcpServer } from './types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from './types';

export interface McpManagementPersistenceOptions {
  storage: McpStorage;
  secretStorage?: SyncSecretStore;
  removeOAuthArtifacts?(serverName: string): Promise<void>;
  publish?(servers: readonly ManagedMcpServer[], changedName: string): Promise<void> | void;
}

export interface McpManagementPersistenceResult {
  revision: string;
  saved: true;
  refreshed: boolean;
  effectiveServer?: ManagedMcpServer;
  removedName?: string;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}

/**
 * Applies agent secret patches without conflating omitted fields with clears.
 * Bearer and OAuth fields are separate patch shapes, but share the same
 * omit=keep/provided=replace/explicit-clear rules.
 */
export function mergeMcpSecretPatch(
  previous: Pick<ManagedMcpServer, 'bearerToken' | 'bearerTokenEnv'>,
  patch: AgentMcpBearerInput | undefined,
): Pick<ManagedMcpServer, 'bearerToken' | 'bearerTokenEnv'>;
export function mergeMcpSecretPatch(
  previous: ManagedMcpServer['oauth'],
  patch: AgentMcpOAuthInput | false | undefined,
): ManagedMcpServer['oauth'];
export function mergeMcpSecretPatch(
  previous: Pick<ManagedMcpServer, 'bearerToken' | 'bearerTokenEnv'> | ManagedMcpServer['oauth'],
  patch: AgentMcpBearerInput | AgentMcpOAuthInput | false | undefined,
): Pick<ManagedMcpServer, 'bearerToken' | 'bearerTokenEnv'> | ManagedMcpServer['oauth'] {
  if (patch === undefined) return previous;
  if (patch === false) return false;
  if ('source' in patch) {
    if (patch.source === 'clear') {
      return { bearerToken: undefined, bearerTokenEnv: undefined };
    }
    return { bearerToken: undefined, bearerTokenEnv: patch.variable };
  }
  const previousOAuth = previous && typeof previous === 'object' && !('bearerToken' in previous)
    ? previous
    : {};
  return {
    ...previousOAuth,
    ...(Object.prototype.hasOwnProperty.call(patch, 'grantType')
      ? { grantType: patch.grantType }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'clientId')
      ? { clientId: patch.clientId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'scope')
      ? { scope: patch.scope }
      : {}),
    ...(patch.clearClientSecret ? { clientSecret: undefined } : {}),
  };
}

function mergeValueMap(
  previousRaw: unknown,
  input: Record<string, { source: string; value?: string; variable?: string }> | undefined,
): Record<string, { kind: 'plain'; value: string } | { kind: 'secret' } | { kind: 'systemEnvironment'; name?: string }> | undefined {
  const next = { ...(normalizeMcpStoredValueMap(previousRaw) ?? {}) };
  if (!input) return Object.keys(next).length ? next : undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value.source === 'clear') delete next[key];
    else if (value.source === 'plain') next[key] = { kind: 'plain', value: value.value ?? '' };
    else next[key] = { kind: 'systemEnvironment', name: value.variable };
  }
  return Object.keys(next).length ? next : undefined;
}

function materializeUpsert(
  name: string,
  input: AgentMcpServerInput,
  previous: ManagedMcpServer | undefined,
): ManagedMcpServer {
  const enabled = input.enabled ?? previous?.enabled ?? DEFAULT_MCP_SERVER.enabled;
  const contextSaving = input.contextSaving ?? previous?.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving;
  const common = {
    name,
    enabled,
    contextSaving,
    disabledTools: input.disabledTools ?? previous?.disabledTools,
    description: input.description ?? previous?.description,
  };
  if ('command' in input) {
    const oldEnv = previous && getMcpServerType(previous.config) === 'stdio'
      ? (previous.config as { env?: unknown }).env
      : undefined;
    const env = mergeValueMap(oldEnv, input.env);
    return {
      ...common,
      config: {
        command: input.command,
        ...(input.args ? { args: [...input.args] } : {}),
        ...(env ? { env } : {}),
      },
    };
  }
  const oldHeaders = previous && getMcpServerType(previous.config) !== 'stdio'
    ? (previous.config as { headers?: unknown }).headers
    : undefined;
  const headers = mergeValueMap(oldHeaders, input.headers);
  const auth = input.auth ?? previous?.auth;
  const canKeepBearer = auth === 'bearer' && previous?.auth === 'bearer';
  const bearer = mergeMcpSecretPatch(
    canKeepBearer
      ? { bearerToken: previous?.bearerToken, bearerTokenEnv: previous?.bearerTokenEnv }
      : { bearerToken: undefined, bearerTokenEnv: undefined },
    input.bearerToken,
  );
  const canKeepOAuth = auth === 'oauth' && previous?.auth === 'oauth';
  const oauth = auth === 'oauth'
    ? mergeMcpSecretPatch(canKeepOAuth ? previous?.oauth : undefined, input.oauth)
    : undefined;
  return {
    ...common,
    config: { type: input.type, url: input.url, ...(headers ? { headers } : {}) },
    ...(auth !== undefined ? { auth } : {}),
    ...(oauth !== undefined ? { oauth } : {}),
    ...(auth === 'bearer' ? bearer : {}),
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown failure';
}

function addFailure(
  failures: Array<{ target: string; message: string }>,
  target: string,
  cause: unknown,
): void {
  failures.push({ target, message: errorMessage(cause) });
}

export class McpManagementPersistence {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: McpManagementPersistenceOptions) {}

  commit(
    plan: McpManagementPlan,
    expectedRevision = plan.revision,
    signal?: AbortSignal,
  ): Promise<McpManagementPersistenceResult> {
    return this.serialized(async () => {
      this.throwIfAborted(signal);
      const loaded = await this.options.storage.loadRevisionedSnapshot();
      const current = loaded.servers;
      if (loaded.revision !== expectedRevision || plan.revision !== expectedRevision) {
        throw new PiviManagementError('state_changed', 'MCP configuration changed after planning.');
      }
      const index = current.findIndex((server) => server.name === plan.mutation.name);
      current.forEach(server => hydrateMcpDirectSecrets(server, this.options.secretStorage));
      const previous = index >= 0 ? current[index] : undefined;
      let effective: ManagedMcpServer | undefined;
      if (plan.mutation.action === 'upsert') {
        effective = materializeUpsert(plan.mutation.name, plan.mutation.server, previous);
        if (index < 0) current.push(effective); else current[index] = effective;
      } else if (plan.mutation.action === 'set_enabled') {
        if (index < 0) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${plan.mutation.name}`);
        effective = { ...current[index]!, enabled: plan.mutation.enabled };
        current[index] = effective;
      } else {
        if (index < 0) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${plan.mutation.name}`);
        current.splice(index, 1);
      }
      this.throwIfAborted(signal);
      let saveResult: { revision: string; cleanupFailures: Array<{ target: string; message: string }> };
      try {
        saveResult = await this.options.storage.saveIfRevision(current, expectedRevision);
      } catch (cause) {
        if (cause instanceof McpStorageStateChangedError) {
          throw new PiviManagementError('state_changed', 'MCP configuration changed after planning.', { cause });
        }
        throw new PiviManagementError('persistence_failed', 'Failed to save MCP configuration.', { cause });
      }

      const failures = [...saveResult.cleanupFailures];
      await this.cleanupAfterCommit(plan.mutation, previous, effective, failures);
      let refreshed = true;
      try {
        await this.options.publish?.(current, plan.mutation.name);
      } catch (cause) {
        refreshed = false;
        addFailure(failures, 'runtime', cause);
      }
      return {
        revision: saveResult.revision,
        saved: true,
        refreshed,
        ...(effective ? { effectiveServer: effective } : { removedName: plan.mutation.name }),
        ...(failures.length ? {
          warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
          refreshFailures: failures.slice(0, 20),
        } : {}),
      };
    });
  }

  async replaceAll(servers: readonly ManagedMcpServer[], expectedRevision: string): Promise<McpManagementPersistenceResult> {
    return this.serialized(async () => {
      const loaded = await this.options.storage.loadRevisionedSnapshot();
      const current = loaded.servers;
      if (loaded.revision !== expectedRevision) {
        throw new PiviManagementError('state_changed', 'MCP configuration changed while Settings was open.');
      }
      let saveResult: { revision: string; cleanupFailures: Array<{ target: string; message: string }> };
      try {
        saveResult = await this.options.storage.saveIfRevision([...servers], expectedRevision);
      } catch (cause) {
        if (cause instanceof McpStorageStateChangedError) {
          throw new PiviManagementError('state_changed', 'MCP configuration changed while Settings was open.', { cause });
        }
        throw new PiviManagementError('persistence_failed', 'Failed to save MCP configuration.', { cause });
      }
      const failures = [...saveResult.cleanupFailures];
      const nextNames = new Set(servers.map((server) => server.name));
      for (const removed of current.filter((server) => !nextNames.has(server.name))) {
        await this.cleanupRemovedServer(removed.name, failures);
      }
      let refreshed = true;
      try {
        await this.options.publish?.(servers, '*');
      } catch (cause) {
        refreshed = false;
        addFailure(failures, 'runtime', cause);
      }
      return {
        revision: saveResult.revision,
        saved: true,
        refreshed,
        ...(failures.length ? {
          warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
          refreshFailures: failures.slice(0, 20),
        } : {}),
      };
    });
  }

  private async cleanupAfterCommit(
    mutation: McpManagementMutation,
    previous: ManagedMcpServer | undefined,
    effective: ManagedMcpServer | undefined,
    failures: Array<{ target: string; message: string }>,
  ): Promise<void> {
    const changedFromRemoteToStdio = !!previous
      && getMcpServerType(previous.config) !== 'stdio'
      && !!effective
      && getMcpServerType(effective.config) === 'stdio';
    const shouldRemoveOAuth = mutation.action === 'remove' || (
      mutation.action === 'upsert'
      && (
        changedFromRemoteToStdio
        || ('url' in mutation.server && mutation.server.oauth === false)
      )
    );
    if (shouldRemoveOAuth) {
      try {
        await this.options.removeOAuthArtifacts?.(mutation.name);
      } catch (cause) {
        addFailure(failures, `oauth:${mutation.name}`, cause);
      }
    }
    if (shouldRemoveOAuth) {
      for (const id of listMcpAuthEntrySecretIds(mutation.name)) {
        this.clearSecret(id, failures);
      }
    }

    const directSecretIds = new Set<string>();
    if (mutation.action === 'remove' || changedFromRemoteToStdio) {
      for (const kind of ['bearer-token', 'client-secret'] as const) {
        listMcpServerSecretIds(mutation.name, kind).forEach(id => directSecretIds.add(id));
      }
    } else if (effective && previous && mutation.action === 'upsert') {
      if (previous.auth === 'bearer' && effective.auth !== 'bearer') {
        listMcpServerSecretIds(mutation.name, 'bearer-token').forEach(id => directSecretIds.add(id));
      }
      if (previous.auth === 'oauth' && effective.auth !== 'oauth') {
        listMcpServerSecretIds(mutation.name, 'client-secret').forEach(id => directSecretIds.add(id));
      }
      if (effective.auth === 'bearer' && effective.bearerTokenEnv) {
        listMcpServerSecretIds(mutation.name, 'bearer-token').forEach(id => directSecretIds.add(id));
      }
      if (effective.auth === 'oauth' && effective.oauth && typeof effective.oauth === 'object' && !effective.oauth.clientSecret) {
        listMcpServerSecretIds(mutation.name, 'client-secret').forEach(id => directSecretIds.add(id));
      }
    }
    if (mutation.action === 'upsert' && 'url' in mutation.server) {
      if (
        mutation.server.bearerToken?.source === 'clear'
        || mutation.server.bearerToken?.source === 'systemEnvironment'
      ) {
        listMcpServerSecretIds(mutation.name, 'bearer-token').forEach(id => directSecretIds.add(id));
      }
      if (
        mutation.server.oauth === false
        || mutation.server.oauth?.clearClientSecret
      ) {
        listMcpServerSecretIds(mutation.name, 'client-secret').forEach(id => directSecretIds.add(id));
      }
    }
    directSecretIds.forEach(id => this.clearSecret(id, failures));
  }

  private async cleanupRemovedServer(
    serverName: string,
    failures: Array<{ target: string; message: string }>,
  ): Promise<void> {
    try {
      await this.options.removeOAuthArtifacts?.(serverName);
    } catch (cause) {
      addFailure(failures, `oauth:${serverName}`, cause);
    }
    for (const id of listMcpAuthEntrySecretIds(serverName)) {
      this.clearSecret(id, failures);
    }
  }

  private clearSecret(id: string, failures: Array<{ target: string; message: string }>): void {
    try {
      this.options.secretStorage?.setSecret(id, '');
    } catch (cause) {
      addFailure(failures, id, cause);
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new PiviManagementError('cancelled', 'MCP management change was cancelled.');
    }
  }
}
