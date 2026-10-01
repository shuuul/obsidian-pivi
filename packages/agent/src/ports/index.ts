import type { ProviderCredential } from '../auth/piProviderCredentials';

export interface WorkspaceFileStat {
  mtime: number;
  size: number;
}

export interface WorkspaceFileStore {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;
  listFolders(path: string): Promise<string[]>;
  listFilesRecursive(path: string): Promise<string[]>;
  ensureFolder(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<WorkspaceFileStat | null>;
}

export type FileStore = WorkspaceFileStore;

export type HomeFileStore = Pick<
  WorkspaceFileStore,
  'exists' | 'read' | 'write' | 'delete' | 'deleteFolder' | 'listFolders' | 'ensureFolder'
>;

/** Synchronous secret persistence used by MCP auth stores. */
export interface SyncSecretStore {
  getSecret(key: string): string | null;
  setSecret(key: string, value: string): void;
  listSecrets(prefix?: string): string[];
  deleteSecret?(key: string): void;
}

export type ProviderLegacyAuthData = Record<string, ProviderCredential>;

export interface ProviderLegacyAuthStore {
  path: string;
  read(): ProviderLegacyAuthData | null;
  write(data: ProviderLegacyAuthData): void;
}

export interface AuthContextHost {
  getEnvironmentVariable(name: string): string | undefined;
  fileExists(path: string): boolean;
  getHomeDirectory(): string;
}

export interface OAuthDeviceCodePrompt {
  verificationUri: string;
  userCode: string;
  message?: string;
}

export interface OAuthFlowHost {
  openAuthUrl(url: string): Promise<void>;
  requestManualCode(message: string, signal: AbortSignal): Promise<string | null>;
  notify?(message: string): void;
  requestDeviceCodeConfirmation?(prompt: OAuthDeviceCodePrompt): Promise<void>;
}

export interface ProviderAuthModel {
  provider: string;
}

export interface ModelAuthHost<TModel extends ProviderAuthModel = ProviderAuthModel, TAuthResult = unknown> {
  getAuth(model: TModel): Promise<TAuthResult | undefined>;
}

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface HttpClient {
  fetch(request: HttpRequest): Promise<HttpResponse>;
}

/** Fetch-compatible function used by MCP SDK, web tools, OAuth, and provider adapters. */
export type FetchCompatible = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Shell is forbidden by default. A reviewed adapter may opt in only when a
 * platform constraint (for example Windows `.cmd`) cannot use argv spawn.
 */
export type ProcessShellPolicy =
  | { mode: 'forbidden' }
  | { mode: 'reviewed-adapter'; reason: string };

/**
 * Every process run must declare a cwd root. Relative `cwd` values resolve
 * under that root; absolute values must stay inside it after realpath.
 */
export type ProcessCwdPolicy =
  | { mode: 'vault'; vaultRoot: string }
  | { mode: 'approved-root'; root: string };

export type ProcessTerminationKind =
  | 'exit'
  | 'signal'
  | 'timeout'
  | 'abort'
  | 'spawn-error'
  | 'forced-kill';

export interface ProcessRunRequest {
  /** Resolved executable path or PATH name; never a shell command string. */
  executable: string;
  args: readonly string[];
  cwdPolicy: ProcessCwdPolicy;
  /** Optional working directory; defaults to the cwd policy root. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Hard deadline for the owned process tree. */
  timeoutMs: number;
  stdoutByteLimit: number;
  stderrByteLimit: number;
  shell: ProcessShellPolicy;
  signal?: AbortSignal;
}

export interface ProcessRunResult {
  termination: ProcessTerminationKind;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** Present when termination is `spawn-error`. */
  spawnError?: string;
  /** Present when termination is `forced-kill`. */
  forcedKillAfter?: 'timeout' | 'abort' | 'signal';
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

export interface ExternalOpener {
  openExternalUrl(url: string): Promise<void>;
}

export type {
  CapabilityApprovalDecision,
  CapabilityApprovalKind,
  CapabilityApprovalPort,
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from './capabilityApproval';
