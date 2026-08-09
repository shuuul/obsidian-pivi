import {
  MobileObsidianVaultApi,
  ObsidianVaultFileAdapter,
} from '@pivi/obsidian-host/mobile';
import {
  createMobileVaultTools,
  type MobileVaultMutationApprovalPort,
} from '@pivi/obsidian-tools/mobile';
import { isSecretStorageAvailable } from '@pivi/pivi-agent-core/auth/providerSecretStorage';
import type { PiBaseToolProvider } from '@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore';
import {
  configurePiAiModels,
  piAiModels,
} from '@pivi/pivi-agent-core/engine/pi/piAiModels';
import { PiChatRuntime } from '@pivi/pivi-agent-core/engine/pi/piChatRuntime';
import { createObsidianCredentialStore } from '@pivi/pivi-agent-core/engine/pi/piProviderCredentialStore';
import type { PiRuntimeHost } from '@pivi/pivi-agent-core/engine/pi/piRuntimeHost';
import { FileStoreSessionJsonlStorage } from '@pivi/pivi-agent-core/engine/pi/session/sessionJsonlStorage';
import { VaultPiSessionStore } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionStore';
import { VaultPiSessionTreeFactory } from '@pivi/pivi-agent-core/engine/pi/session/vaultPiSessionTree';
import {
  DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
  type ObsidianToolsSettings,
} from '@pivi/pivi-agent-core/foundation';
import type { PiChatService } from '@pivi/pivi-agent-core/runtime/piChatService';
import type { App } from 'obsidian';

import { ObsidianDeviceLocalExternalContextStore } from '@/app/deviceLocalExternalContextStore';
import { ObsidianDeviceLocalProviderStore } from '@/app/deviceLocalProviderStore';

import type { PiviPlatformCapabilities } from '../../platformCapabilities';
import { createBrowserFetchTransport } from './browserFetchTransport';
import { createBrowserHttpClient } from './browserHttpClient';
import { MOBILE_VAULT_TOOLS, projectMobileCapabilities } from './capabilityProjection';
import { MobileArchivedSessions } from './MobileArchivedSessions';
import { activeProviderId, isMobileRemoteProvider } from './mobileProviderPolicy';
import { sanitizeMobileDiagnostic } from './sanitizeMobileDiagnostic';

export interface MobileReadiness {
  secretStorage: boolean;
  provider: boolean;
  model: boolean;
  credential: boolean;
  tools: boolean;
  ready: boolean;
  missing: readonly string[];
}

/** Mobile-only dependency graph. Keep this file free of desktop app barrels and Node authorities. */
export class MobileWorkspace {
  readonly files: ObsidianVaultFileAdapter;
  readonly sessionStorage: FileStoreSessionJsonlStorage;
  readonly sessionTrees: VaultPiSessionTreeFactory;
  readonly sessions: VaultPiSessionStore;
  readonly externalContexts: ObsidianDeviceLocalExternalContextStore;
  readonly providers: ObsidianDeviceLocalProviderStore;
  readonly archivedSessions: MobileArchivedSessions;
  readonly tools;
  readonly baseToolProvider: PiBaseToolProvider;

  private readonly runtimes = new Set<PiChatService>();
  private readonly surfaceListeners = new Set<() => void>();
  /** Credentials seen on this device; retained in memory only so late writes remain redactable. */
  private readonly knownSecrets = new Set<string>();
  private disposed = false;

  constructor(
    readonly app: App,
    capabilities: PiviPlatformCapabilities,
    approval: MobileVaultMutationApprovalPort,
  ) {
    if (capabilities.platform !== 'mobile') throw new Error('Mobile workspace requires Mobile capabilities');
    this.files = new ObsidianVaultFileAdapter(app);
    this.sessionStorage = new FileStoreSessionJsonlStorage(
      this.files,
      undefined,
      content => this.sanitizeSessionWrite(content),
    );
    this.sessionTrees = new VaultPiSessionTreeFactory(this.sessionStorage);
    this.externalContexts = new ObsidianDeviceLocalExternalContextStore(app);
    this.sessions = new VaultPiSessionStore(this.sessionStorage, this.sessionTrees, {
      externalContexts: this.externalContexts,
    });
    this.providers = new ObsidianDeviceLocalProviderStore(app);
    this.archivedSessions = new MobileArchivedSessions(app);
    this.tools = createMobileVaultTools({
      vault: new MobileObsidianVaultApi(app),
      settings: {} as ObsidianToolsSettings,
      approval,
      vaultName: app.vault.getName(),
    });
    const names = this.tools.map(tool => tool.name);
    const projection = projectMobileCapabilities(capabilities, names);
    if (!projection.canExposeComposer) {
      throw new Error(`Mobile tool inventory is incomplete: ${projection.missingRequiredTools.join(', ')}`);
    }
    this.baseToolProvider = options => ({
      toolSpecs: createMobileVaultTools({
        vault: new MobileObsidianVaultApi(app),
        settings: {} as ObsidianToolsSettings,
        approval,
        vaultName: app.vault.getName(),
        resolveReadMaxChars: options.resolveReadMaxChars,
      }),
      registeredToolSummary: {
        obsidianTools: [...MOBILE_VAULT_TOOLS],
        obsidianCliAvailable: false,
        includeMcp: false,
        includeSkill: false,
        includeSubagent: false,
        includeWebSearch: false,
      },
    });

    for (const registration of this.providers.loadInitialized()?.providers ?? []) {
      this.readAndRememberCredential(registration.id);
    }
    const credentials = createObsidianCredentialStore(app.secretStorage);
    const mobileCustomProviders = this.providers.loadInitialized()?.providers
      .filter(registration => registration.type === 'custom' && isMobileRemoteProvider(registration))
      .map(registration => registration.type === 'custom' ? registration.config : null)
      .filter(config => config !== null) ?? [];
    configurePiAiModels({
      ...(credentials ? { credentials } : {}),
      providerFetch: createBrowserFetchTransport({ fetch: globalThis.fetch }),
      customProviders: mobileCustomProviders,
      getApiKey: providerId => {
        const credential = this.readAndRememberCredential(providerId);
        return credential?.type === 'api_key'
          && typeof credential.key === 'string'
          && credential.key.trim()
          ? credential.key
          : undefined;
      },
    });
  }

  readiness(): MobileReadiness {
    const secretStorage = isSecretStorageAvailable(this.app.secretStorage);
    const state = this.providers.loadInitialized();
    const activeModel = state?.modelPreferences.activeModel?.trim() ?? '';
    const activeProvider = activeProviderId(state);
    const registration = state?.providers.find(item => item.id === activeProvider);
    const provider = !!registration && isMobileRemoteProvider(registration);
    const model = provider && this.isRegisteredModel(activeModel);
    const credential = provider && this.hasApiKey(activeProvider!);
    const tools = this.tools.length === MOBILE_VAULT_TOOLS.length
      && MOBILE_VAULT_TOOLS.every(name => this.tools.some(tool => tool.name === name));
    const missing = [
      ...(!secretStorage ? ['Secure storage is unavailable.'] : []),
      ...(!provider ? ['Choose a provider in Pivi settings.'] : []),
      ...(!model ? ['Choose a registered model in Pivi settings.'] : []),
      ...(provider && !credential ? ['Enter this provider’s API key on this device.'] : []),
      ...(!tools ? ['Required Vault tools are unavailable.'] : []),
    ];
    return {
      secretStorage,
      provider,
      model,
      credential,
      tools,
      ready: missing.length === 0,
      missing,
    };
  }

  /**
   * Constructs PiChatRuntime directly for Mobile. Does not reuse desktop ChatPorts.
   * Subagents stay disabled through host settings so the engine omits spawn_agent.
   */
  createChatRuntime(): PiChatService {
    if (this.disposed) {
      throw new Error('Mobile workspace is disposed.');
    }
    const browserFetch = createBrowserFetchTransport({ fetch: globalThis.fetch });
    const runtime = new PiChatRuntime(
      this.createRuntimeHost(),
      {
        httpClient: createBrowserHttpClient(browserFetch),
        mcpFetch: browserFetch,
        mcpProcessEnv: {},
      },
      this.sessionTrees,
      null,
      null,
      this.baseToolProvider,
      undefined,
      null,
      null,
    );
    this.runtimes.add(runtime);
    return runtime;
  }

  /** Tracked surface refresh after settings/readiness changes. */
  onSurfacesChanged(listener: () => void): () => void {
    this.surfaceListeners.add(listener);
    return () => {
      this.surfaceListeners.delete(listener);
    };
  }

  notifySurfacesChanged(): void {
    for (const listener of [...this.surfaceListeners]) listener();
  }

  /** Settings are device-local authority; no runtime may retain an older model snapshot. */
  invalidateRuntimes(): void {
    for (const runtime of [...this.runtimes]) {
      try {
        runtime.cancel();
      } catch {
        // Best-effort invalidation.
      }
      try {
        runtime.cleanup();
      } catch {
        // Best-effort invalidation.
      }
    }
    this.runtimes.clear();
  }

  configureProvider(providerId: string, modelId: string): void {
    const model = `${providerId}/${modelId}`;
    const current = this.providers.loadInitialized();
    const registration = current?.providers.find(item => item.id === providerId);
    if (registration && !isMobileRemoteProvider(registration)) {
      throw new Error('Mobile supports only remote HTTPS API-key providers.');
    }
    if (['openai-codex', 'grok-build', 'claude'].includes(providerId)) {
      throw new Error('Mobile does not support OAuth-only providers.');
    }
    if (!this.isRegisteredModel(model)) {
      throw new Error('The selected model is not registered by Pi.');
    }
    this.providers.save({
      version: 1,
      initialized: true,
      providers: [registration
        ? { ...registration, disabled: false }
        : { id: providerId, type: 'builtin', disabled: false }],
      modelPreferences: {
        visibleModels: [model], activeModel: model, titleGenerationModel: model,
        customContextLimits: {},
      },
      webSearchTools: DEFAULT_WEB_SEARCH_TOOLS_SETTINGS,
    });
  }

  setApiKey(providerId: string, apiKey: string): void {
    const credentials = createObsidianCredentialStore(this.app.secretStorage);
    if (!credentials) throw new Error('Secure storage is unavailable.');
    credentials.writeSync(providerId, { type: 'api_key', key: apiKey });
    if (apiKey) this.knownSecrets.add(apiKey);
  }

  deleteApiKey(providerId: string): void {
    const credentials = createObsidianCredentialStore(this.app.secretStorage);
    this.rememberCredential(credentials?.readSync(providerId));
    credentials?.clearSync(providerId);
  }

  hasApiKey(providerId: string): boolean {
    const credential = this.readAndRememberCredential(providerId);
    return credential?.type === 'api_key'
      && typeof credential.key === 'string'
      && credential.key.trim().length > 0;
  }

  readCredential(providerId: string) {
    return this.readAndRememberCredential(providerId);
  }

  restoreCredential(providerId: string, credential: ReturnType<MobileWorkspace['readCredential']>): void {
    const credentials = createObsidianCredentialStore(this.app.secretStorage);
    if (!credentials) throw new Error('Secure storage is unavailable.');
    if (credential) {
      credentials.writeSync(providerId, credential);
      const secret = credential.type === 'api_key' ? credential.key : credential.access;
      if (secret) this.knownSecrets.add(secret);
    }
    else credentials.clearSync(providerId);
  }

  /** Sanitizes at the UI boundary without returning the active credential to callers. */
  sanitizeDiagnostic(value: string): string {
    const state = this.providers.loadInitialized();
    const providerId = activeProviderId(state);
    const credential = providerId
      ? createObsidianCredentialStore(this.app.secretStorage)?.readSync(providerId)
      : undefined;
    const secret = credential?.type === 'api_key' ? credential.key : credential?.access;
    return this.sanitizeKnownSecrets(sanitizeMobileDiagnostic(value, secret));
  }

  private sanitizeKnownSecrets(value: string): string {
    let sanitized = value;
    const replacement = [...this.knownSecrets].some(secret => secret && '[credential redacted]'.includes(secret))
      ? ''
      : '[credential redacted]';
    for (const secret of [...this.knownSecrets].sort((left, right) => right.length - left.length)) {
      sanitized = secret ? sanitized.replaceAll(secret, replacement) : sanitized;
    }
    if ([...this.knownSecrets].some(secret => secret && sanitized.includes(secret))) {
      throw new Error('Credential redaction could not produce a safe session value.');
    }
    return sanitized;
  }

  /** Redact JSON string values without allowing a short credential to corrupt JSON field names. */
  private sanitizeSessionWrite(content: string): string {
    const credentials = createObsidianCredentialStore(this.app.secretStorage);
    for (const credential of credentials?.listStoredSync() ?? []) {
      this.rememberCredential(credential);
    }
    if (this.knownSecrets.size === 0) return content;
    const trailingLf = content.endsWith('\n');
    const lines = content.split('\n');
    if (trailingLf) lines.pop();
    const sanitized = lines.map(line => {
      const parsed: unknown = JSON.parse(line);
      this.assertNoSecretKeys(parsed);
      return JSON.stringify(parsed, (_key, value) => {
        if (typeof value === 'string') return this.sanitizeKnownSecrets(value);
        return value as unknown;
      });
    }).join('\n');
    return trailingLf ? `${sanitized}\n` : sanitized;
  }

  private readAndRememberCredential(providerId: string) {
    const credential = createObsidianCredentialStore(this.app.secretStorage)?.readSync(providerId);
    this.rememberCredential(credential);
    return credential;
  }

  private rememberCredential(credential: ReturnType<MobileWorkspace['readCredential']>): void {
    if (credential?.type === 'api_key') {
      if (credential.key) this.knownSecrets.add(credential.key);
      return;
    }
    if (credential?.type === 'oauth') {
      if (credential.access) this.knownSecrets.add(credential.access);
      if (credential.refresh) this.knownSecrets.add(credential.refresh);
    }
  }

  private assertNoSecretKeys(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) this.assertNoSecretKeys(item);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if ([...this.knownSecrets].some(secret => secret && key.includes(secret))) {
        throw new Error('Session payload contains a credential in an object key.');
      }
      this.assertNoSecretKeys(child);
    }
  }

  /** Synchronously cancel/cleanup every tracked runtime and block further construction. */
  dispose(): void {
    this.disposed = true;
    this.invalidateRuntimes();
    this.surfaceListeners.clear();
  }

  private createRuntimeHost(): PiRuntimeHost {
    const state = this.providers.loadInitialized();
    const activeModel = state?.modelPreferences.activeModel?.trim() || undefined;
    const titleModel = state?.modelPreferences.titleGenerationModel?.trim() || activeModel;
    return {
      getVaultPath: () => null,
      settings: {
        ...(activeModel ? { model: activeModel } : {}),
        ...(titleModel ? { titleGenerationModel: titleModel } : {}),
        // Engine can disable subagents only through this settings bag.
        agentSettings: {
          subagents: {
            enabled: false,
            maxConcurrentSubagents: 1,
            allowBackground: false,
          },
        },
      },
    };
  }

  private providerIdFromModel(modelKey: string): string | null {
    const slash = modelKey.indexOf('/');
    return slash > 0 && slash < modelKey.length - 1 ? modelKey.slice(0, slash) : null;
  }

  private isRegisteredModel(modelKey: string): boolean {
    const providerId = this.providerIdFromModel(modelKey);
    if (!providerId) return false;
    try {
      return !!piAiModels.getModel(providerId, modelKey.slice(providerId.length + 1));
    } catch {
      return false;
    }
  }

}
