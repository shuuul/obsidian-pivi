import type { ManagedMcpServer } from '../mcp';
import type { SlashCatalogEntry } from '../skills';
import type { ToolSpec } from '../tools';

export type PluginSourceKind = 'builtin' | 'local' | 'git' | 'npm' | 'url';

export interface PluginSource {
  kind: PluginSourceKind;
  location: string;
  ref?: string;
}

export interface PiviPluginResources {
  skills?: string[];
  prompts?: string[];
  tools?: string[];
  contextProviders?: string[];
  mcpServers?: string[];
  commands?: string[];
  themes?: string[];
}

export interface PluginCapability {
  id: string;
  description?: string;
  required?: boolean;
}

export interface PiviPluginManifest {
  id: string;
  name: string;
  version?: string;
  source: PluginSource;
  resources: PiviPluginResources;
  capabilities?: PluginCapability[];
}

export interface PluginTrustDecision {
  trusted: boolean;
  decidedAt: number;
  decidedBy?: string;
  reason?: string;
}

export interface PluginLockRecord {
  pluginId: string;
  source: PluginSource;
  resolvedRef?: string;
  integrity?: string;
  enabledResources?: PiviPluginResources;
  trust?: PluginTrustDecision;
}

export interface PluginLockfile {
  version: 1;
  plugins: PluginLockRecord[];
}

export interface PluginRegistryRecord {
  manifest: PiviPluginManifest;
  enabled: boolean;
  installPath?: string;
  lock?: PluginLockRecord;
}

export interface PluginResourceLocation {
  source: PluginSource;
  manifestPath?: string;
}

export interface PluginResourceLoader {
  loadManifest(location: PluginResourceLocation): Promise<unknown>;
  loadContribution(record: PluginRegistryRecord): Promise<PluginContribution>;
}

export interface ToolProvider {
  id: string;
  listTools(context: Record<string, unknown>): Promise<ToolSpec[]>;
}

export interface SkillSourceProvider {
  id: string;
  listSkillResources(context: Record<string, unknown>): Promise<string[]>;
}

export interface PromptContribution {
  id: string;
  content: string;
}

export interface ContextProviderContribution {
  id: string;
  title?: string;
}

export type SlashCommandContribution = SlashCatalogEntry;

export type McpServerPreset = ManagedMcpServer;

export interface PluginContribution {
  pluginId: string;
  tools?: ToolProvider[];
  skills?: SkillSourceProvider[];
  prompts?: PromptContribution[];
  contexts?: ContextProviderContribution[];
  commands?: SlashCommandContribution[];
  mcpPresets?: McpServerPreset[];
}

const RESOURCE_KEYS = [
  'skills',
  'prompts',
  'tools',
  'contextProviders',
  'mcpServers',
  'commands',
  'themes',
] as const;

type ResourceKey = typeof RESOURCE_KEYS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Plugin manifest field "${key}" must be a non-empty string.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Plugin manifest field "${key}" must be a non-empty string when present.`);
  }
  return value;
}

function parseSource(value: unknown): PluginSource {
  if (!isRecord(value)) {
    throw new Error('Plugin manifest field "source" must be an object.');
  }
  const kind = readRequiredString(value, 'kind');
  if (!['builtin', 'local', 'git', 'npm', 'url'].includes(kind)) {
    throw new Error(`Unsupported plugin source kind "${kind}".`);
  }
  return {
    kind: kind as PluginSourceKind,
    location: readRequiredString(value, 'location'),
    ref: readOptionalString(value, 'ref'),
  };
}

function readStringArray(record: Record<string, unknown>, key: ResourceKey): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  const arrayValue = value as unknown[];
  if (!Array.isArray(arrayValue) || arrayValue.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`Plugin manifest resources.${key} must be an array of non-empty strings.`);
  }
  return [...(arrayValue as string[])];
}

function parseResources(value: unknown): PiviPluginResources {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('Plugin manifest field "resources" must be an object when present.');
  }

  const resources: PiviPluginResources = {};
  for (const key of RESOURCE_KEYS) {
    const entries = readStringArray(value, key);
    if (entries && entries.length > 0) {
      resources[key] = entries;
    }
  }
  return resources;
}

function parseCapabilities(value: unknown): PluginCapability[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('Plugin manifest field "capabilities" must be an array when present.');
  }
  return value.map((entry) => {
    if (typeof entry === 'string') {
      return { id: entry };
    }
    if (!isRecord(entry)) {
      throw new Error('Plugin manifest capabilities must be strings or objects.');
    }
    return {
      id: readRequiredString(entry, 'id'),
      description: readOptionalString(entry, 'description'),
      required: typeof entry.required === 'boolean' ? entry.required : undefined,
    };
  });
}

export function parsePiviPluginManifest(input: unknown): PiviPluginManifest {
  if (!isRecord(input)) {
    throw new Error('Plugin manifest must be an object.');
  }
  return {
    id: readRequiredString(input, 'id'),
    name: readRequiredString(input, 'name'),
    version: readOptionalString(input, 'version'),
    source: parseSource(input.source),
    resources: parseResources(input.resources),
    capabilities: parseCapabilities(input.capabilities),
  };
}

export function createPluginLockfile(records: PluginLockRecord[]): PluginLockfile {
  return {
    version: 1,
    plugins: records.map((record) => ({ ...record })),
  };
}

export class PluginRegistry {
  private readonly records = new Map<string, PluginRegistryRecord>();

  constructor(records: PluginRegistryRecord[] = []) {
    for (const record of records) {
      this.upsert(record);
    }
  }

  list(): PluginRegistryRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  get(pluginId: string): PluginRegistryRecord | null {
    const record = this.records.get(pluginId);
    return record ? { ...record } : null;
  }

  upsert(record: PluginRegistryRecord): void {
    this.records.set(record.manifest.id, { ...record });
  }

  remove(pluginId: string): boolean {
    return this.records.delete(pluginId);
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const record = this.records.get(pluginId);
    if (!record) {
      throw new Error(`Unknown plugin "${pluginId}".`);
    }
    this.records.set(pluginId, { ...record, enabled });
  }

  enabledRecords(): PluginRegistryRecord[] {
    return this.list().filter((record) => record.enabled);
  }
}

export async function loadPluginContribution(
  loader: PluginResourceLoader,
  record: PluginRegistryRecord,
): Promise<PluginContribution | null> {
  if (!record.enabled) {
    return null;
  }
  return loader.loadContribution(record);
}

export async function loadPluginContributions(
  loader: PluginResourceLoader,
  records: PluginRegistryRecord[],
): Promise<PluginContribution[]> {
  const contributions: PluginContribution[] = [];
  for (const record of records) {
    const contribution = await loadPluginContribution(loader, record);
    if (contribution) {
      contributions.push(contribution);
    }
  }
  return contributions;
}
