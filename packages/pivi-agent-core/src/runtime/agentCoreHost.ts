import type { AgentEngine } from '../engine';
import type { PluginContribution, ToolProvider } from '../plugins';
import type {
  AuthService,
  Clock,
  ExternalOpener,
  HttpClient,
  Logger,
  ProcessRunner,
  RuntimeUiCallbacks,
  SecretStore,
  WorkspaceFileStore,
} from '../ports';
import type { PromptContributor } from '../prompt';
import type { SessionStore } from '../session';
import type { WorkspaceContext } from '../workspace';

export interface AgentCoreContextProvider<TContext = unknown, TRequest = unknown> {
  id: string;
  getContext(request: TRequest): Promise<TContext | null | undefined>;
}

export interface AgentCoreSkillStore {
  listSkills(): Promise<unknown[]>;
  readSkill(skillId: string): Promise<unknown>;
  buildPromptFragments(): Promise<string[]>;
}

export interface AgentCoreMcpServices {
  prepareTurn?(request: unknown): Promise<unknown>;
  listTools?(): Promise<unknown[]>;
  authenticate?(serverName: string): Promise<unknown>;
  logout?(serverName: string): Promise<void>;
  extractMentions?(content: string): Set<string>;
  transformMentions?(content: string): string;
}

export interface AgentCoreHost {
  workspace: WorkspaceContext;
  files: WorkspaceFileStore;
  sessions: SessionStore;
  engine: AgentEngine;
  tools: ToolProvider[];
  contextProviders: AgentCoreContextProvider[];
  appData?: WorkspaceFileStore;
  cache?: WorkspaceFileStore;
  secrets?: SecretStore;
  skills?: AgentCoreSkillStore | null;
  mcp?: AgentCoreMcpServices | null;
  auth?: AuthService;
  network?: HttpClient;
  process?: ProcessRunner;
  opener?: ExternalOpener;
  prompts?: PromptContributor[];
  plugins?: PluginContribution[];
  ui?: RuntimeUiCallbacks;
  logger?: Logger;
  clock?: Clock;
}
